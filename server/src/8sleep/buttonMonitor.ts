// Pod 5 cover physical-button support.
//
// The Pod 5 cover has three buttons per side (+ / logo / -) wired to a TCA8418
// keypad the stock frank firmware receives but deliberately ignores (it logs
// `[TTC] ignoring short top click(s)` and never bumps the DEVICE_STATUS tap
// counters). Frank DOES write every press into the RAW capture as `log`
// records, so we tail the newest /persistent/*.RAW file, extract the button
// log lines, debounce/classify them, and apply the actions the firmware
// declined to.
//
// Resilience contract (this runs unattended at 3 AM next to bed control):
//  - Never blocks: setInterval with an in-flight guard, incremental reads only.
//  - Fail-soft: any parse/dispatch error is caught and logged; a bad byte
//    resyncs rather than crashing.
//  - EVERY promise is caught. An unhandled rejection triggers a full server
//    shutdown (server.ts), which would take out bed control.
//  - Offset lives in memory only; on rollover to a newer file we start at 0.
//  - Gated behind settings.features.coverButtons.

import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import cbor from 'cbor';
import moment from 'moment-timezone';

import logger from '../logger.js';
import settingsDB from '../db/settings.js';
import memoryDB from '../db/memoryDB.js';
import serverStatus from '../serverStatus.js';
import eventBus from '../events/eventBus.js';
import { recordEvent } from '../db/collector.js';
import { Side } from '../db/schedulesSchema.js';
import { getDeviceStatusCoalesced } from './frankenServer.js';
import { updateDeviceStatus } from '../routes/deviceStatus/updateDeviceStatus.js';
import { executeFunction } from './deviceApi.js';
import { applyTemperatureDelta } from './applyTemperatureChange.js';
import { markManualTempChange } from '../jobs/scheduleOverride.js';
import {
  readRawRecord,
  RawTruncatedError,
  RawFramingError,
} from './rawLogReader.js';
import {
  ButtonEventMachine,
  ButtonEvent,
  ButtonName,
} from './buttonEvents.js';

// Directory holding the pod's rolling *.RAW captures. Overridable via env for
// tests and local dev; production leaves it at the pod's /persistent.
const RAW_DIR = process.env.POD_RAW_DIR || '/persistent';
const POLL_MS = 1_000;
// Only tagged inner chunks at/under this many bytes are CBOR-decoded. Frank
// batches multiple log records per chunk (~1.6KB observed live); piezo-dual
// chunks are large binary payloads that never contain the ASCII button tags,
// so the tag pre-filter is the real piezo guard and this cap is a backstop.
const MAX_TAGGED_CHUNK_BYTES = 16 * 1024;
// How much of the tail to read per tick. Frank appends slowly; a press is one
// short record. Cap the read so a huge backlog (first open of a large file)
// can't allocate an enormous buffer in one shot.
const MAX_READ_CHUNK = 1 << 20; // 1 MiB
// A short soft pulse to confirm a handled temperature press. du is in seconds;
// we clear it ourselves after this many ms so it's a brief buzz, not an alarm.
const HAPTIC_INTENSITY = 15;
const HAPTIC_DURATION_S = 1;
const HAPTIC_CLEAR_MS = 1_000;
// How long an optimistic target stays authoritative over the device snapshot.
// Long enough to cover a burst of presses + the franken round-trip, short
// enough that app/schedule changes take back over quickly.
const PENDING_TARGET_TTL_MS = 10_000;

interface TailState {
  file: string;
  offset: number;
  // Leftover bytes from a record that was truncated at the read boundary,
  // prepended to the next chunk.
  carry: Buffer;
}

// Fast ASCII pre-filter: does this small record contain a button log tag?
// Avoids a full CBOR decode for unrelated short log lines.
const TAG_TCA = Buffer.from('[tca8418');
const TAG_BTN = Buffer.from('[buttons]');
function bufferHasTag(data: Buffer): boolean {
  return data.includes(TAG_TCA) || data.includes(TAG_BTN);
}

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class ButtonMonitor {
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight = false;
  private tail: TailState | null = null;
  private readonly machine = new ButtonEventMachine();
  // Optimistic per-side target: rapid presses land faster than the device
  // status refreshes (observed live: three +1 presses in one second all read
  // the same stale target and netted +2). After we change the target, use OUR
  // value as the base for the next press instead of the coalesced snapshot,
  // for a short freshness window.
  private pendingTargets: Partial<Record<Side, { f: number; at: number }>> = {};

  public start(): void {
    if (this.timer) {
      logger.warn('[buttonMonitor] already running');
      return;
    }
    logger.info('[buttonMonitor] starting (poll every ' + POLL_MS + 'ms)');
    this.markStatus('started', '');
    // unref so the poll timer never keeps the process alive on its own.
    this.timer = setInterval(() => { void this.tick(); }, POLL_MS);
    this.timer.unref?.();
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private markStatus(status: 'healthy' | 'failed' | 'started' | 'not_started', message = ''): void {
    const s = serverStatus.status.buttonMonitor;
    if (!s) return;
    const prev = s.status;
    s.status = status;
    s.message = message;
    s.timestamp = moment.tz().format();
    if (prev !== status) {
      eventBus.emit('service-health', { buttonMonitor: s });
    }
  }

  // One poll tick. Wrapped so it can NEVER throw or reject into the interval.
  private async tick(): Promise<void> {
    if (this.inFlight) return; // previous tick still working; skip
    this.inFlight = true;
    try {
      await settingsDB.read();
      if (!settingsDB.data.features.coverButtons) {
        // Disabled: hold status calm and do nothing.
        this.markStatus('not_started', 'coverButtons disabled');
        return;
      }

      const newest = await this.findNewestRawFile();
      if (!newest) {
        // No RAW files yet; not an error (fresh pod / internet-blocked).
        this.markStatus('healthy', 'no RAW file');
        return;
      }

      // Rollover: frank writes a new hex-named file ~every 15 min. When the
      // newest file changes, reset offset/carry and start from the top of the
      // new file. The state machine's pending presses are per-file transient;
      // clearing them on rollover avoids a press stuck "down" forever.
      if (!this.tail || this.tail.file !== newest) {
        logger.debug(`[buttonMonitor] tailing ${newest}`);
        this.tail = { file: newest, offset: 0, carry: Buffer.alloc(0) };
      }

      await this.readAppended();
      this.markStatus('healthy', '');
    } catch (error) {
      // Fail-soft: log and keep polling. Do not rethrow.
      this.markStatus('failed', errMsg(error));
      logger.warn(`[buttonMonitor] tick failed: ${errMsg(error)}`);
    } finally {
      this.inFlight = false;
    }
  }

  // Find the newest *.RAW in /persistent by mtime, excluding SEQNO.RAW.
  private async findNewestRawFile(): Promise<string | null> {
    let entries: string[];
    try {
      entries = await fsp.readdir(RAW_DIR);
    } catch {
      return null; // dir missing (local dev); caller treats as no-file
    }
    let newest: string | null = null;
    let newestMtime = -Infinity;
    for (const name of entries) {
      if (!name.endsWith('.RAW') || name === 'SEQNO.RAW') continue;
      const full = path.join(RAW_DIR, name);
      try {
        const st = await fsp.stat(full);
        if (!st.isFile()) continue;
        if (st.mtimeMs > newestMtime) {
          newestMtime = st.mtimeMs;
          newest = full;
        }
      } catch {
        // File vanished mid-scan (frank rolled it); skip.
      }
    }
    return newest;
  }

  // Read bytes appended since our last offset, parse out log records, dispatch.
  private async readAppended(): Promise<void> {
    const tail = this.tail!;
    let st: fs.Stats;
    try {
      st = await fsp.stat(tail.file);
    } catch {
      // File disappeared; force re-discovery next tick.
      this.tail = null;
      return;
    }

    // File truncated/replaced under the same name (size shrank): restart it.
    if (st.size < tail.offset) {
      tail.offset = 0;
      tail.carry = Buffer.alloc(0);
    }

    const available = st.size - tail.offset;
    if (available <= 0) return; // nothing new

    const toRead = Math.min(available, MAX_READ_CHUNK);
    const buf = Buffer.alloc(toRead);
    let bytesRead = 0;
    const fh = await fsp.open(tail.file, 'r');
    try {
      const res = await fh.read(buf, 0, toRead, tail.offset);
      bytesRead = res.bytesRead;
    } finally {
      await fh.close();
    }
    if (bytesRead <= 0) return;

    // Prepend any carry from a record that straddled the previous read.
    const chunk = tail.carry.length
      ? Buffer.concat([tail.carry, buf.subarray(0, bytesRead)])
      : buf.subarray(0, bytesRead);
    tail.carry = Buffer.alloc(0);

    let cursor = 0;
    // consumedFromChunk maps back to the source-file offset advance. The number
    // of raw file bytes consumed equals cursor over the part of chunk that came
    // from the file (i.e. cursor minus the carry we prepended). We advance the
    // file offset by bytesRead unconditionally at the end and stash any
    // unconsumed tail as carry, so offset math stays simple and monotonic.
    const events: ButtonEvent[] = [];
    while (cursor < chunk.length) {
      let rec;
      try {
        rec = readRawRecord(chunk, cursor);
      } catch (error) {
        if (error instanceof RawTruncatedError) {
          // Incomplete record at the end: keep it as carry for next tick.
          tail.carry = Buffer.from(chunk.subarray(cursor));
          break;
        }
        if (error instanceof RawFramingError) {
          // Resync: skip one byte and try to re-lock onto a record start.
          cursor += 1;
          continue;
        }
        // Unknown error: bail out of this chunk, keep going next tick.
        logger.warn(`[buttonMonitor] parse error: ${errMsg(error)}`);
        break;
      }
      if (rec === null) break; // only padding left
      cursor = rec.nextOffset;
      const ev = this.classifyRecord(rec.data);
      if (ev) events.push(...ev);
    }

    // Advance the file offset past everything we pulled off disk. Anything not
    // yet consumed lives in carry, so we never re-read those bytes.
    tail.offset += bytesRead;

    for (const ev of events) {
      await this.dispatch(ev);
    }
  }

  // Decode an inner chunk and, if it holds button log lines, run them through
  // the edge machine. Verified against live capture (Sep 7 2026): frank
  // BATCHES several CBOR log records into one outer chunk (~1.6KB observed),
  // so a chunk containing a button line can far exceed a single log record's
  // size and holds multiple concatenated CBOR maps. The tag pre-filter is the
  // cheap gate; the size cap only protects against decoding piezo payloads,
  // which never contain the ASCII tags.
  private classifyRecord(data: Buffer): ButtonEvent[] {
    if (data.length === 0 || data.length > MAX_TAGGED_CHUNK_BYTES) return [];
    // Cheap pre-filter: only decode chunks that mention our tags. Avoids
    // CBOR-decoding unrelated log chunks and all piezo data.
    if (!bufferHasTag(data)) return [];
    let items: unknown[];
    try {
      items = cbor.decodeAllSync(data);
    } catch {
      // Partial decode salvage: decodeAllSync throws if ANY item is bad.
      // Fall back to the first item so one corrupt trailing record doesn't
      // discard a valid button press in the same chunk.
      try {
        items = [cbor.decodeFirstSync(data)];
      } catch {
        return [];
      }
    }
    const events: ButtonEvent[] = [];
    for (const decoded of items) {
      if (!decoded || typeof decoded !== 'object') continue;
      const rec = decoded as { type?: unknown; msg?: unknown };
      if (rec.type !== 'log' || typeof rec.msg !== 'string') continue;
      events.push(...this.machine.push(rec.msg));
    }
    return events;
  }

  private async dispatch(ev: ButtonEvent): Promise<void> {
    try {
      await settingsDB.read();
      const side: Side = ev.side;
      const cfg = settingsDB.data[side].buttons;

      // Middle (logo) click: dismiss a vibrating alarm, else jump the side to
      // its saved favorite temperature. Single click for both - a groggy
      // sleeper shouldn't need a double-click to stop the buzzing, and the
      // favorite jump is the button's whole job when no alarm is active.
      if (ev.button === 'middle') {
        if (ev.kind === 'hold') return; // reserve holds for future mapping
        await memoryDB.read();
        if (memoryDB.data[side].isAlarmVibrating === true) {
          await this.handleAlarmDismiss(side);
        } else {
          await this.handleFavoriteTemperature(side, cfg.favoriteTemperatureF);
        }
        return;
      }

      // Hold events on top/bottom are not mapped to anything yet; record and
      // skip so a long-press doesn't spam temperature.
      if (ev.kind === 'hold') {
        recordEvent('button_press', {
          side,
          payload: { side, button: ev.button, kind: ev.kind, action: 'ignored_hold' },
          source: '8sleep/buttonMonitor',
        });
        return;
      }

      // Top/bottom click -> temperature. invertButtons swaps which physical
      // button counts as +. Resolved HERE (not in the parser) so the user can
      // flip it live via settings if +/- come out reversed on the hardware.
      const isPlus = cfg.invertButtons
        ? ev.button === 'bottom'
        : ev.button === 'top';
      const deltaF = isPlus ? cfg.stepF : -cfg.stepF;

      await this.handleTemperature(side, deltaF, ev.button);
    } catch (error) {
      // Never let a dispatch failure escape as an unhandled rejection.
      logger.warn(`[buttonMonitor] dispatch failed (${ev.side}/${ev.button}/${ev.kind}): ${errMsg(error)}`);
      this.markStatus('failed', errMsg(error));
    }
  }

  private async handleTemperature(side: Side, deltaF: number, button: ButtonName): Promise<void> {
    // Need the live target to increment from. If we can't read it, skip rather
    // than guess a base value.
    let currentTargetF: number | undefined;
    try {
      const status = await getDeviceStatusCoalesced();
      currentTargetF = status?.[side]?.targetTemperatureF;
    } catch (error) {
      logger.warn(`[buttonMonitor] could not read device status for temp press: ${errMsg(error)}`);
      return;
    }
    if (typeof currentTargetF !== 'number' || !Number.isFinite(currentTargetF)) {
      logger.warn(`[buttonMonitor] no target temperature for ${side}; skipping press`);
      return;
    }

    const pending = this.pendingTargets[side];
    const base = pending && Date.now() - pending.at < PENDING_TARGET_TTL_MS
      ? pending.f
      : currentTargetF;
    const newTargetF = await applyTemperatureDelta(side, base, deltaF);
    this.pendingTargets[side] = { f: newTargetF, at: Date.now() };

    recordEvent('button_press', {
      side,
      payload: {
        side,
        button,
        kind: 'click',
        action: deltaF > 0 ? 'temp_up' : 'temp_down',
        deltaF,
      },
      source: '8sleep/buttonMonitor',
    });

    // Haptic echo AFTER the temperature change, gated + never during an alarm.
    await this.maybeHaptic(side);
  }

  // Middle (logo) button with no active alarm: set the side to its saved
  // favorite temperature, powering the side on if it was off. An absolute set,
  // not a delta - pressing it twice is idempotent.
  private async handleFavoriteTemperature(side: Side, favoriteF: number): Promise<void> {
    await updateDeviceStatus(
      { [side]: { isOn: true, targetTemperatureF: favoriteF } } as Parameters<typeof updateDeviceStatus>[0],
    );
    this.pendingTargets[side] = { f: favoriteF, at: Date.now() };
    await markManualTempChange(side, { to: favoriteF });
    recordEvent('button_press', {
      side,
      payload: { side, button: 'middle', kind: 'click', action: 'favorite_temp', favoriteF },
      source: '8sleep/buttonMonitor',
    });
    await this.maybeHaptic(side);
  }

  private async handleAlarmDismiss(side: Side): Promise<void> {
    await memoryDB.read();
    const vibrating = memoryDB.data[side].isAlarmVibrating === true;
    if (!vibrating) {
      // Middle double-click with no active alarm is a no-op.
      recordEvent('button_press', {
        side,
        payload: { side, button: 'middle', kind: 'click', action: 'dismiss_noop' },
        source: '8sleep/buttonMonitor',
      });
      return;
    }
    // Same path the API's ALARM_CLEAR uses (updateDeviceStatus isAlarmVibrating
    // false -> ALARM_CLEAR + memoryDB flip + alarm_cleared event).
    await updateDeviceStatus({ [side]: { isAlarmVibrating: false } });
    recordEvent('button_press', {
      side,
      payload: { side, button: 'middle', kind: 'click', action: 'alarm_dismiss' },
      source: '8sleep/buttonMonitor',
    });
  }

  private async maybeHaptic(side: Side): Promise<void> {
    await settingsDB.read();
    if (!settingsDB.data[side].buttons.hapticEcho) return;
    // Never buzz while a real alarm is vibrating.
    await memoryDB.read();
    if (memoryDB.data[side].isAlarmVibrating === true) return;

    try {
      const payload = {
        pl: HAPTIC_INTENSITY,
        du: HAPTIC_DURATION_S,
        pi: 'double',
        tt: moment.tz(settingsDB.data.timeZone || 'UTC').unix(),
      };
      const hex = cbor.encode(payload).toString('hex');
      const command = side === 'left' ? 'ALARM_LEFT' : 'ALARM_RIGHT';
      await executeFunction(command, hex);
      // Clear the pulse shortly after so it's a brief confirmation, not an
      // alarm. Detached timer: catch its own rejection so it can't escape.
      setTimeout(() => {
        void (async () => {
          try {
            await executeFunction('ALARM_CLEAR', 'empty');
          } catch (error) {
            logger.warn(`[buttonMonitor] haptic clear failed: ${errMsg(error)}`);
          }
        })();
      }, HAPTIC_CLEAR_MS);
    } catch (error) {
      logger.warn(`[buttonMonitor] haptic echo failed: ${errMsg(error)}`);
    }
  }
}

let singleton: ButtonMonitor | null = null;

export function startButtonMonitor(): void {
  if (!singleton) singleton = new ButtonMonitor();
  singleton.start();
}

export function stopButtonMonitor(): void {
  singleton?.stop();
}
