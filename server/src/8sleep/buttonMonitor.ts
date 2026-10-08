// The buttons on a Pod 5 cover: three per side, plus, logo and minus. The
// firmware logs every press to the RAW capture's `log` records and ignores
// short clicks, so this monitor tails the newest /persistent/*.RAW file for
// the button lines and applies the clicks: plus and minus step the side's
// target, the logo button stops a ringing or snoozed alarm and otherwise sets
// the side to its favorite temperature. Long presses are left to the
// firmware, which on newer host firmware reports them through the tap
// counters that FrankenMonitor handles.
//
// Checked on one Pod 4 hub with a Pod 5 cover (docs/EIGHT_SLEEP_PROTOCOL.md,
// "Other Pod generations"). Off unless settings.features.coverButtons is on;
// off, no RAW file is opened.
//
// It runs unattended next to bed control, so: it never blocks (one poll at a
// time, incremental reads), every error is caught and logged, a bad byte
// resyncs rather than stops, and no promise is left to reject on its own,
// since an unhandled rejection shuts the whole server down.

import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import cbor from 'cbor';
import moment from 'moment-timezone';
import { DeepPartial } from 'ts-essentials';

import logger from '../logger.js';
import settingsDB from '../db/settings.js';
import serverStatus from '../serverStatus.js';
import eventBus from '../events/eventBus.js';
import { Side } from '../db/schedulesSchema.js';
import { DeviceStatus, MIN_TEMPERATURE_F, MAX_TEMPERATURE_F } from '../routes/deviceStatus/deviceStatusSchema.js';
import { getDeviceStatusCoalesced } from './frankenServer.js';
import { updateDeviceStatus } from '../routes/deviceStatus/updateDeviceStatus.js';
import { markManualTempChange } from '../jobs/scheduleOverride.js';
import { activeAlarms, hasSnooze } from '../jobs/activeAlarms.js';
import { handleAlarmTap } from './tapAlarm.js';
import { readRawRecord, RawTruncatedError, RawFramingError } from './rawLogReader.js';
import { ButtonEventMachine, ButtonEvent, ButtonName } from './buttonEvents.js';

// Where the firmware writes its rolling RAW captures. Tests point it elsewhere.
const RAW_DIR = process.env.POD_RAW_DIR || '/persistent';
const POLL_MS = 1_000;
// Inner chunks over this size are not decoded. The firmware batches several
// log records into one chunk (about 1.6 KB seen live); piezo chunks are far
// larger and never carry the button tags that gate decoding below anyway.
const MAX_TAGGED_CHUNK_BYTES = 16 * 1024;
// Most of a file read per poll, so the first look at a large file does not
// allocate it whole.
const MAX_READ_CHUNK = 1 << 20;
// How long a target written here is the base for the next press. Presses
// come faster than the device status refreshes, so without this three quick
// plus presses all read the same target and net one step.
const WRITTEN_TARGET_MS = 10_000;
// The oldest press acted on. The firmware batches about a minute of log
// records per chunk, so a press can be 15 to 25 s old when first readable;
// anything older is history, for example a file read again after a restart.
const MAX_PRESS_AGE_MS = 30_000;
// A RAW file older than this is not being written: the firmware has stopped,
// or writes to a stream instead.
const STALE_RAW_MS = 15_000;

interface TailState {
  file: string;
  offset: number;
  // Bytes of a record cut off at the end of the last read, read again first.
  carry: Buffer;
}

// Only chunks that mention a button tag are decoded.
const TAG_KEYPAD = Buffer.from('[tca8418');
const TAG_BUTTONS = Buffer.from('[buttons]');
function hasButtonTag(data: Buffer): boolean {
  return data.includes(TAG_KEYPAD) || data.includes(TAG_BUTTONS);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class ButtonMonitor {
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight = false;
  private tail: TailState | null = null;
  private firstPoll = true;
  private readonly startedAt = Date.now();
  private readonly machine = new ButtonEventMachine();
  private writtenTargets: Partial<Record<Side, { targetF: number; at: number }>> = {};
  // A press this poll could not apply, reported instead of a healthy status.
  private pollError: string | null = null;

  public start(): void {
    if (this.timer) {
      logger.warn('[buttonMonitor] already running');
      return;
    }
    logger.info(`[buttonMonitor] starting (poll every ${POLL_MS} ms)`);
    this.markStatus('started');
    this.timer = setInterval(() => { void this.poll(); }, POLL_MS);
    this.timer.unref?.();
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private markStatus(status: 'healthy' | 'failed' | 'started', message = ''): void {
    const entry = serverStatus.status.buttonMonitor;
    const changed = entry.status !== status || entry.message !== message;
    entry.status = status;
    entry.message = message;
    entry.timestamp = moment.tz().format();
    if (changed) eventBus.emit('service-health', { buttonMonitor: entry });
  }

  // One poll. It never throws or rejects into the interval.
  private async poll(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    this.pollError = null;
    try {
      await settingsDB.read();
      if (!settingsDB.data.features.coverButtons) {
        this.markStatus('healthy', 'Off in Settings > Features');
        return;
      }

      const newest = await this.findNewestRawFile();
      const firstPoll = this.firstPoll;
      this.firstPoll = false;
      if (!newest) {
        this.markStatus('failed', `No RAW files in ${RAW_DIR}`);
        return;
      }

      // The firmware starts a new file every few minutes. A new file is read
      // from its start. The first file after a start is read from its end:
      // the presses already in it were made before this server ran, and the
      // RAW archive keeps old files that must never be replayed.
      if (!this.tail || this.tail.file !== newest) {
        logger.debug(`[buttonMonitor] tailing ${newest}`);
        const offset = firstPoll ? (await fsp.stat(newest)).size : 0;
        this.tail = { file: newest, offset, carry: Buffer.alloc(0) };
      }

      await this.readAppended();
      const age = Date.now() - (await fsp.stat(newest)).mtimeMs;
      if (age < 0 || age > STALE_RAW_MS) {
        this.markStatus('failed', 'The RAW file is not being written');
      } else if (this.pollError) {
        this.markStatus('failed', this.pollError);
      } else {
        this.markStatus('healthy');
      }
    } catch (error) {
      this.markStatus('failed', errorMessage(error));
      logger.warn(`[buttonMonitor] poll failed: ${errorMessage(error)}`);
    } finally {
      this.inFlight = false;
    }
  }

  // The newest *.RAW by modification time. SEQNO.RAW is the firmware's
  // sequence counter, not a capture.
  private async findNewestRawFile(): Promise<string | null> {
    let entries: string[];
    try {
      entries = await fsp.readdir(RAW_DIR);
    } catch {
      return null;
    }
    let newest: string | null = null;
    let newestMtime = -Infinity;
    for (const name of entries) {
      if (!name.endsWith('.RAW') || name === 'SEQNO.RAW') continue;
      const full = path.join(RAW_DIR, name);
      try {
        const stats = await fsp.stat(full);
        if (!stats.isFile()) continue;
        if (stats.mtimeMs > newestMtime) {
          newestMtime = stats.mtimeMs;
          newest = full;
        }
      } catch {
        // Rolled away between readdir and stat.
      }
    }
    return newest;
  }

  // Reads the bytes appended since the last poll, parses the log records out
  // of them and acts on the button events.
  private async readAppended(): Promise<void> {
    const tail = this.tail;
    if (!tail) return;
    let stats: fs.Stats;
    try {
      stats = await fsp.stat(tail.file);
    } catch {
      this.tail = null;
      return;
    }

    // Shorter than before: replaced under the same name, so read it from the start.
    if (stats.size < tail.offset) {
      tail.offset = 0;
      tail.carry = Buffer.alloc(0);
    }

    const available = stats.size - tail.offset;
    if (available <= 0) return;

    const toRead = Math.min(available, MAX_READ_CHUNK);
    const buffer = Buffer.alloc(toRead);
    let bytesRead = 0;
    const handle = await fsp.open(tail.file, 'r');
    try {
      ({ bytesRead } = await handle.read(buffer, 0, toRead, tail.offset));
    } finally {
      await handle.close();
    }
    if (bytesRead <= 0) return;

    const chunk = tail.carry.length
      ? Buffer.concat([tail.carry, buffer.subarray(0, bytesRead)])
      : buffer.subarray(0, bytesRead);
    tail.carry = Buffer.alloc(0);

    const events: ButtonEvent[] = [];
    let cursor = 0;
    while (cursor < chunk.length) {
      let record;
      try {
        record = readRawRecord(chunk, cursor);
      } catch (error) {
        if (error instanceof RawTruncatedError) {
          tail.carry = Buffer.from(chunk.subarray(cursor));
          break;
        }
        if (error instanceof RawFramingError) {
          cursor += 1;
          continue;
        }
        logger.warn(`[buttonMonitor] parse error: ${errorMessage(error)}`);
        break;
      }
      if (record === null) break;
      cursor = record.nextOffset;
      events.push(...this.eventsIn(record.data));
    }

    // The file offset moves past everything read; what was not consumed is
    // in the carry and is read again from there, never from the file.
    tail.offset += bytesRead;

    for (const event of events) {
      await this.dispatch(event);
    }
  }

  // The button events in one inner chunk, which holds several concatenated
  // CBOR maps, most of them unrelated log lines.
  private eventsIn(data: Buffer): ButtonEvent[] {
    if (data.length === 0 || data.length > MAX_TAGGED_CHUNK_BYTES) return [];
    if (!hasButtonTag(data)) return [];
    let items: unknown[];
    try {
      items = cbor.decodeAllSync(data);
    } catch {
      // decodeAllSync gives up on the first bad item; keep what the first
      // item holds rather than lose a press to a corrupt neighbour.
      try {
        items = [cbor.decodeFirstSync(data)];
      } catch {
        return [];
      }
    }
    const events: ButtonEvent[] = [];
    const now = Date.now();
    for (const decoded of items) {
      if (!decoded || typeof decoded !== 'object') continue;
      const record = decoded as { type?: unknown; msg?: unknown; ts?: unknown };
      if (record.type !== 'log' || typeof record.msg !== 'string') continue;
      if (typeof record.ts !== 'number' || !Number.isFinite(record.ts)) continue;
      const at = record.ts * 1000;
      if (at < this.startedAt || at > now + 1000 || now - at > MAX_PRESS_AGE_MS) continue;
      events.push(...this.machine.push(record.msg));
    }
    return events;
  }

  private async dispatch(event: ButtonEvent): Promise<void> {
    try {
      await settingsDB.read();
      const side: Side = event.side;
      const buttons = settingsDB.data[side].buttons;

      if (event.kind === 'hold') {
        // The firmware owns long presses; see the file comment.
        logger.debug(`[buttonMonitor] ${side} ${event.button} held, left to the firmware`);
        return;
      }

      if (event.button === 'middle') {
        if (activeAlarms.has(side) || hasSnooze(side)) {
          logger.info(`[buttonMonitor] ${side} logo button: stopping the alarm`);
          await handleAlarmTap(side, {
            type: 'alarm', behavior: 'dismiss', snoozeDuration: 60, inactiveAlarmBehavior: 'none',
          });
        } else {
          await this.setFavorite(side, buttons.favoriteTemperatureF);
        }
        return;
      }

      // invertButtons swaps which end of the cover warms the bed, settled here
      // so it can be flipped in settings without a restart.
      const warms = buttons.invertButtons ? event.button === 'bottom' : event.button === 'top';
      await this.step(side, warms ? buttons.stepF : -buttons.stepF, event.button);
    } catch (error) {
      logger.warn(`[buttonMonitor] ${event.side} ${event.button} ${event.kind} failed: ${errorMessage(error)}`);
      this.pollError = errorMessage(error);
    }
  }

  private async step(side: Side, deltaF: number, button: ButtonName): Promise<void> {
    let readTarget: number | undefined;
    try {
      const status = await getDeviceStatusCoalesced();
      readTarget = status[side]?.targetTemperatureF;
    } catch (error) {
      logger.warn(`[buttonMonitor] could not read the device status for a ${button} press: ${errorMessage(error)}`);
      return;
    }
    if (typeof readTarget !== 'number' || !Number.isFinite(readTarget)) {
      logger.warn(`[buttonMonitor] no target for the ${side} side; skipping the press`);
      return;
    }

    const written = this.writtenTargets[side];
    const base = written && Date.now() - written.at < WRITTEN_TARGET_MS ? written.targetF : readTarget;
    const targetF = Math.max(MIN_TEMPERATURE_F, Math.min(MAX_TEMPERATURE_F, base + deltaF));
    logger.info(`[buttonMonitor] ${side} ${button} button: ${base} -> ${targetF} F`);
    await updateDeviceStatus({ [side]: { targetTemperatureF: targetF } } as DeepPartial<DeviceStatus>, { background: true });
    this.writtenTargets[side] = { targetF, at: Date.now() };
    // A press counts as a manual change for the schedule override, as a tap does.
    await markManualTempChange(side);
  }

  // The logo button with no alarm: the side's favorite temperature, on if it
  // was off. An absolute target, so pressing it again changes nothing.
  private async setFavorite(side: Side, favoriteF: number): Promise<void> {
    logger.info(`[buttonMonitor] ${side} logo button: ${favoriteF} F and on`);
    await updateDeviceStatus({ [side]: { isOn: true, targetTemperatureF: favoriteF } } as DeepPartial<DeviceStatus>, { background: true });
    this.writtenTargets[side] = { targetF: favoriteF, at: Date.now() };
    await markManualTempChange(side);
  }
}

let monitor: ButtonMonitor | null = null;

export function startButtonMonitor(): void {
  if (!monitor) monitor = new ButtonMonitor();
  monitor.start();
}

export function stopButtonMonitor(): void {
  monitor?.stop();
}
