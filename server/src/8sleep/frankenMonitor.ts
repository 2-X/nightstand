import moment from 'moment-timezone';
import logger from '../logger.js';
import settingsDB from '../db/settings.js';
import memoryDB from '../db/memoryDB.js';
import { connectFranken, FrankenCommandTimeoutError } from './frankenServer.js';
import { wait } from './promises.js';
import { DeviceStatus } from '../routes/deviceStatus/deviceStatusSchema.js';
import { Side } from '../db/schedulesSchema.js';
import { Gesture, GestureSchema } from '../db/settingsSchema.js';
import { applyTemperatureDelta } from './applyTemperatureChange.js';
import serverStatus from '../serverStatus.js';
import { trimixBase } from './trimixBaseControl.js';
import { BASE_PRESETS } from './basePresets.js';
import eventBus from '../events/eventBus.js';
import { recordEvent } from '../db/collector.js';
import { getFreshOptimisticTarget, confirmTarget, setOptimisticTarget } from './optimisticTargets.js';

// Pod 4+ only: gestures and the 2s cadence are the only path. The Pod 3
// 60s slow-poll branch was removed alongside the WebSocket initiative.
//
// IMPORTANT: this loop is also where physical-tap gestures (quad-tap to
// toggle the base, double/triple-tap for temperature) are detected, by
// diffing the franken status snapshot against the previous one. So this
// cadence is also the worst-case quad-tap latency. We previously throttled
// to 10s when no WebSocket clients were connected, which made quad-tap take
// 5-10s when the app wasn't open. Gestures are a physical interaction
// independent of whether anyone's watching the app, so always poll fast.
const POLL_MS = 2_000;


export class FrankenMonitor {
  private isRunning: boolean;
  private deviceStatus?: DeviceStatus;
  private currentBasePreset: keyof typeof BASE_PRESETS = 'flat';

  constructor() {
    this.isRunning = false;
    this.deviceStatus = undefined;
  }

  public async start() {
    if (this.isRunning) {
      logger.warn('FrankenMonitor is already running');
      return;
    }
    this.isRunning = true;
    this.frankenLoop().catch(error => {
      logger.error(error);
      this.markStatus('failed', String(error));
    });
  }

  public stop() {
    if (!this.isRunning) return;
    logger.debug('Stopping FrankenMonitor loop');
    this.isRunning = false;
  }

  private markStatus(status: 'healthy' | 'failed', message = '') {
    const prev = serverStatus.status.frankenMonitor.status;
    serverStatus.status.frankenMonitor.status = status;
    serverStatus.status.frankenMonitor.message = message;
    serverStatus.status.frankenMonitor.timestamp = moment.tz().format();
    if (prev !== status) {
      eventBus.emit('service-health', { frankenMonitor: serverStatus.status.frankenMonitor });
    }
  }

  // `polledTargetF` is the target from the snapshot that carried this gesture.
  // A fresh optimistic target (a cover-button press or an earlier gesture in
  // the same tick) wins over it, so back-to-back gestures stack instead of all
  // being computed from the same stale value.
  private async processGesture(side: Side, gesture: Gesture, polledTargetF: number) {
    const behavior = settingsDB.data[side].taps[gesture];
    logger.debug(`[processGesture] side: ${side}, gesture: ${gesture}, type: ${behavior.type}`);

    if (behavior.type === 'temperature') {
      const currentTemperatureTarget = getFreshOptimisticTarget(side) ?? polledTargetF;
      const deltaF = behavior.change === 'increment' ? behavior.amount : -behavior.amount;
      // Shared with the Pod 5 cover-button path so both physical controls apply
      // identical temperature semantics (see applyTemperatureChange.ts).
      const newTargetF = await applyTemperatureDelta(side, currentTemperatureTarget, deltaF);
      setOptimisticTarget(side, newTargetF);
      return;
    } else if (behavior.type === 'base_control') {
      this.currentBasePreset =
        this.currentBasePreset === 'relax' ? 'flat' : 'relax';

      const targetPreset = BASE_PRESETS[this.currentBasePreset];

      // If the base is already at the target position, skip the BLE command
      // entirely. Calling setPosition with the same position is a no-op at
      // the hardware level, but it leaves isMoving=true in memoryDB with
      // no incoming position-change packets to ever clear it (the timeout
      // in trimixBaseControl.parseNotification only gets armed inside the
      // positionChanged branch). The result is a permanently stuck "Stop
      // movement" button on the elevation page.
      const current = memoryDB.data?.baseStatus;
      if (current && current.head === targetPreset.head && current.feet === targetPreset.feet) {
        logger.info(
          `[quadTap] Already at ${this.currentBasePreset} preset (head=${current.head}, feet=${current.feet}); skipping setPosition.`,
        );
        return;
      }

      logger.info(
        `[quadTap] Cycling base to ${this.currentBasePreset} preset:`,
        targetPreset,
      );

      try {
        if (memoryDB.data) {
          memoryDB.data.baseStatus = {
            head: targetPreset.head,
            feet: targetPreset.feet,
            isMoving: true,
            lastUpdate: new Date().toISOString(),
            isConfigured: true,
          };
          await memoryDB.write();
        }

        if (this.currentBasePreset === 'flat') {
          await trimixBase.goToFlat();
        } else {
          await trimixBase.setPosition({
            head: targetPreset.head,
            feet: targetPreset.feet,
            feedRate: targetPreset.feedRate,
          });
        }
      } catch (error) {
        logger.error(
          `[quadTap] Failed to set base preset: ${error instanceof Error ? error.message : String(error)}`,
        );
        this.currentBasePreset =
        this.currentBasePreset === 'relax' ? 'flat' : 'relax';
      }

    } else if (behavior.type) {
      // TODO: Add alarm handling
      logger.warn('Skipping gesture...');
    }
  }

  private processGesturesForSide(nextDeviceStatus: DeviceStatus, side: Side) {
    try {
      const changed: Gesture[] = [];
      for (const gesture of GestureSchema.options) {
        if (nextDeviceStatus[side].taps?.[gesture] !== this?.deviceStatus?.[side].taps?.[gesture]) {
          // Fire-and-forget journal write; recordEvent only enqueues in memory
          // and never throws, so it adds no latency to the tap-detection path.
          recordEvent('tap_gesture', { side, payload: { side, kind: gesture }, source: '8sleep/frankenMonitor' });
          changed.push(gesture);
        }
      }
      if (changed.length === 0) return;

      const polledTargetF = nextDeviceStatus[side].targetTemperatureF;
      // Deliberately detached from the poll loop: a base move takes seconds
      // over BLE and this loop doubles as the tap-detection cadence, so
      // awaiting here would delay the next gesture. Detached means the
      // surrounding try cannot see a rejection, and an unhandled one takes the
      // whole server down (the process-level handler shuts it down), so each
      // gesture is caught here.
      //
      // Within one tick the gestures run one after another, not in parallel:
      // the newer host firmware reports a cover long-press as a tap gesture,
      // and two of them landing in the same 2 s snapshot used to be applied
      // against the same base (observed live: -24 -> -16 and -24 -> -24
      // written back to back instead of stacking). Each gesture now sees the
      // target the previous one just wrote.
      void (async () => {
        for (const gesture of changed) {
          try {
            await this.processGesture(side, gesture, polledTargetF);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logger.error(`Failed to process ${gesture} on the ${side} side: ${message}`);
            this.markStatus('failed', message);
          }
        }
      })();
    } catch (error) {
      logger.error(error);
    }
  }

  // Not async: it awaits nothing, and an async function called without await
  // is the same floating-promise trap the gesture calls above just closed.
  private processGestures(nextDeviceStatus: DeviceStatus) {
    if (!this.deviceStatus) {
      logger.warn('Missing current deviceStatus, exiting...');
      return;
    }

    this.processGesturesForSide(nextDeviceStatus, 'left');
    this.processGesturesForSide(nextDeviceStatus, 'right');
  }

  // Cheap deep-equality for the status payload. The shape is stable so a
  // JSON round-trip is the simplest correct comparison.
  private hasStatusChanged(next: DeviceStatus): boolean {
    if (!this.deviceStatus) return true;
    return JSON.stringify(this.deviceStatus) !== JSON.stringify(next);
  }

  private async frankenLoop() {
    const franken = await connectFranken();
    try {
      this.deviceStatus = await franken.getDeviceStatus(true);
      eventBus.emit('device-status', this.deviceStatus);
    } catch (error) {
      // A failed first read must not kill the monitor before its retry loop
      // even starts: the loop below fetches every tick, and gestures resume
      // once a snapshot lands.
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`FrankenMonitor: initial device status failed (${message}); will retry in loop`);
    }

    while (this.isRunning) {
      try {
        while (this.isRunning) {
          await wait(POLL_MS);
          if (!this.isRunning) break;
          const f = await connectFranken();
          let nextDeviceStatus: DeviceStatus;
          try {
            nextDeviceStatus = await f.getDeviceStatus(true);
          } catch (error) {
            if (error instanceof FrankenCommandTimeoutError) {
              logger.warn(`FrankenMonitor: ${error.message}; will retry next tick`);
              this.markStatus('failed', error.message);
              continue;
            }
            throw error;
          }

          await settingsDB.read();
          this.processGestures(nextDeviceStatus);

          // Overlay fresh optimistic targets (physical button presses) so a
          // poll that was in flight when a press landed can't regress the
          // just-broadcast value; clears itself once franken confirms.
          for (const side of ['left', 'right'] as const) {
            const optimistic = getFreshOptimisticTarget(side);
            if (optimistic === null) continue;
            if (nextDeviceStatus[side].targetTemperatureF === optimistic) {
              confirmTarget(side, optimistic);
            } else {
              nextDeviceStatus[side].targetTemperatureF = optimistic;
            }
          }

          if (this.hasStatusChanged(nextDeviceStatus)) {
            eventBus.emit('device-status', nextDeviceStatus);
          }
          this.deviceStatus = nextDeviceStatus;
          this.markStatus('healthy', '');
        }
      } catch (error) {
        this.markStatus('failed', String(error));
        logger.error(error instanceof Error ? error.message : String(error), 'franken disconnected');
        await wait(POLL_MS);
      }
    }
    logger.debug('FrankenMonitor loop exited');
  }
}
