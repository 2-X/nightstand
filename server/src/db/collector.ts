// The ONLY writer for the Phase 0 "collect everything" tables:
// bed_state_samples, hub_state_samples, pod_events, config_audit.
//
// Design constraints (docs/DATA.md risk sweep):
//  - NEVER block the FrankenMonitor 2s loop. This module only *subscribes* to
//    the eventBus 'device-status' stream; it adds no dac.sock callers and does
//    not touch the poll loop.
//  - Fire-and-forget on the hot path: recordEvent / recordConfigAudit and the
//    device-status handler enqueue synchronously and return. Nothing on the
//    hot path awaits a DB call.
//  - EVERY promise is caught and logged at warn. An unhandled rejection in
//    this codebase triggers a full server shutdown (server.ts
//    unhandledRejection handler), which would take out bed control. So the
//    flush is the single place that awaits, and it swallows all errors.
//  - Batched writes: an in-memory queue flushed every 30s or at 50 rows via
//    one short prisma.$transaction(createMany) to limit eMMC wear and SQLite
//    contention with the Python side.

import { prisma } from './prisma.js';
import logger from '../logger.js';
import eventBus from '../events/eventBus.js';
import type { DeviceStatus } from '../routes/deviceStatus/deviceStatusSchema.js';

// --- Retention constants (see pruneOldRows / the daily retention job) ---
export const BED_HUB_RETENTION_DAYS = 400;
export const EVENT_AUDIT_RETENTION_DAYS = 730;

// --- Sampling / batching tuning ---
// Heartbeat floor: write a sample at least this often per side / for the hub,
// even when nothing changed, so gaps in the series are real outages not just
// "value held steady".
const HEARTBEAT_MS = 60_000;
const FLUSH_INTERVAL_MS = 30_000;
const FLUSH_AT_ROWS = 50;

type Side = 'left' | 'right';

// Prisma createMany input row shapes (id/autoincrement omitted).
type BedRow = {
  side: string;
  timestamp: number;
  current_level: number | null;
  target_level: number | null;
  current_temp_f: number | null;
  target_temp_f: number | null;
  is_on: boolean;
};
type HubRow = {
  timestamp: number;
  ambient_c: number | null;
  heatsink_c: number | null;
  left_c: number | null;
  right_c: number | null;
  water_ok: boolean | null;
  is_priming: boolean | null;
  wifi_strength: number | null;
};
type EventRow = {
  timestamp: number;
  type: string;
  side: string | null;
  payload: string;
  source: string;
};
type AuditRow = {
  timestamp: number;
  kind: string;
  source: string;
  snapshot: string;
};

// In-memory queues. Flushed together on the interval / size trigger.
const bedQueue: BedRow[] = [];
const hubQueue: HubRow[] = [];
const eventQueue: EventRow[] = [];
const auditQueue: AuditRow[] = [];

const queuedRows = (): number =>
  bedQueue.length + hubQueue.length + eventQueue.length + auditQueue.length;

// Last *written* (enqueued) sample per side, for change/heartbeat diffing.
type LastBed = {
  ts: number;
  current_level: number | null;
  target_level: number | null;
  is_on: boolean;
};
const lastBed: Partial<Record<Side, LastBed>> = {};

type LastHub = {
  ts: number;
  ambient_c: number | null;
  heatsink_c: number | null;
  water_ok: boolean | null;
  is_priming: boolean | null;
  wifi_strength: number | null;
};
let lastHub: LastHub | undefined;

// Last full device-status snapshot, for deriving transition events (power,
// water, prime) without touching frankenMonitor.
type LastTransitionState = {
  left_on: boolean;
  right_on: boolean;
  water_ok: boolean | null;
  is_priming: boolean;
};
let lastTransition: LastTransitionState | undefined;

let flushTimer: NodeJS.Timeout | undefined;
let unsubscribe: (() => void) | undefined;
let started = false;

const nowSec = (): number => Math.floor(Date.now() / 1000);

// waterLevel is the raw firmware string: 'true' => water OK, 'false' => low
// (see app/src/pages/ControlTempPage/WaterNotification.tsx). Anything else
// ('good', undefined, ...) is unknown => null.
const parseWaterOk = (waterLevel: string | undefined): boolean | null => {
  if (waterLevel === 'true') return true;
  if (waterLevel === 'false') return false;
  return null;
};

// --- Public API ------------------------------------------------------------

/**
 * Record a discrete event. Fire-and-forget: enqueues synchronously, never
 * throws, never returns a promise the caller must handle.
 */
export function recordEvent(
  type: string,
  opts: { side?: string | null; payload?: unknown; source: string },
): void {
  try {
    eventQueue.push({
      timestamp: nowSec(),
      type,
      side: opts.side ?? null,
      payload: JSON.stringify(opts.payload ?? {}),
      source: opts.source,
    });
    maybeFlushBySize();
  } catch (error) {
    logger.warn(`[collector] recordEvent(${type}) failed to enqueue: ${errMsg(error)}`);
  }
}

/**
 * Record a config/command audit entry. Fire-and-forget.
 */
export function recordConfigAudit(kind: string, source: string, snapshot: unknown): void {
  try {
    auditQueue.push({
      timestamp: nowSec(),
      kind,
      source,
      snapshot: JSON.stringify(snapshot ?? {}),
    });
    maybeFlushBySize();
  } catch (error) {
    logger.warn(`[collector] recordConfigAudit(${kind}) failed to enqueue: ${errMsg(error)}`);
  }
}

/**
 * Subscribe to the eventBus 'device-status' stream and start the periodic
 * flush. Idempotent.
 */
export function startCollector(): void {
  if (started) {
    logger.warn('[collector] startCollector called twice, ignoring');
    return;
  }
  started = true;

  unsubscribe = eventBus.subscribe('device-status', (env) => {
    // Detached from the emit path deliberately: this handler runs on the
    // frankenMonitor's emit, so it must never throw or await.
    try {
      onDeviceStatus(env.payload);
    } catch (error) {
      logger.warn(`[collector] onDeviceStatus failed: ${errMsg(error)}`);
    }
  });

  flushTimer = setInterval(() => {
    void flush();
  }, FLUSH_INTERVAL_MS);
  flushTimer.unref?.();

  logger.info('[collector] started (subscribed to device-status)');
}

/**
 * Stop the collector: unsubscribe, stop the timer, flush what's queued.
 * Primarily for tests and graceful shutdown.
 */
export async function stopCollector(): Promise<void> {
  if (!started) return;
  started = false;
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = undefined;
  }
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = undefined;
  }
  await flush();
}

// --- device-status handling ------------------------------------------------

// Exported for unit testing the on-change / heartbeat / transition logic
// without spinning up the eventBus.
export function onDeviceStatus(status: DeviceStatus): void {
  const ts = nowSec();
  sampleBedSide(status, 'left', ts);
  sampleBedSide(status, 'right', ts);
  sampleHub(status, ts);
  deriveTransitionEvents(status, ts);
}

function sampleBedSide(status: DeviceStatus, side: Side, ts: number): void {
  const s = status[side];
  if (!s) return;
  const current_level = numOrNull(s.currentTemperatureLevel);
  const target_level = deriveTargetLevel(s.targetTemperatureF);
  const is_on = s.isOn;

  const prev = lastBed[side];
  const changed =
    !prev ||
    prev.current_level !== current_level ||
    prev.target_level !== target_level ||
    prev.is_on !== is_on;
  const heartbeatDue = !prev || ts - prev.ts >= Math.floor(HEARTBEAT_MS / 1000);

  if (!changed && !heartbeatDue) return;

  bedQueue.push({
    side,
    timestamp: ts,
    current_level,
    target_level,
    current_temp_f: numOrNull(s.currentTemperatureF),
    target_temp_f: numOrNull(s.targetTemperatureF),
    is_on,
  });
  lastBed[side] = { ts, current_level, target_level, is_on };
  maybeFlushBySize();
}

function sampleHub(status: DeviceStatus, ts: number): void {
  const water_ok = parseWaterOk(status.waterLevel);
  const is_priming = status.isPriming;
  const wifi_strength = numOrNull(status.wifiStrength);
  const ambient_c = status.sensorTemps?.ambientC ?? null;
  const heatsink_c = status.sensorTemps?.heatsinkC ?? null;
  const left_c = status.sensorTemps?.leftC ?? null;
  const right_c = status.sensorTemps?.rightC ?? null;

  const prev = lastHub;
  const changed =
    !prev ||
    prev.ambient_c !== ambient_c ||
    prev.heatsink_c !== heatsink_c ||
    prev.water_ok !== water_ok ||
    prev.is_priming !== is_priming ||
    prev.wifi_strength !== wifi_strength;
  const heartbeatDue = !prev || ts - prev.ts >= Math.floor(HEARTBEAT_MS / 1000);

  if (!changed && !heartbeatDue) return;

  hubQueue.push({
    timestamp: ts,
    ambient_c,
    heatsink_c,
    left_c,
    right_c,
    water_ok,
    is_priming,
    wifi_strength,
  });
  lastHub = { ts, ambient_c, heatsink_c, water_ok, is_priming, wifi_strength };
  maybeFlushBySize();
}

// Derive discrete transition events by diffing consecutive snapshots, so these
// don't require touching frankenMonitor. First snapshot only seeds baseline.
function deriveTransitionEvents(status: DeviceStatus, _ts: number): void {
  const water_ok = parseWaterOk(status.waterLevel);
  const next: LastTransitionState = {
    left_on: status.left?.isOn ?? false,
    right_on: status.right?.isOn ?? false,
    water_ok,
    is_priming: status.isPriming,
  };

  const prev = lastTransition;
  lastTransition = next;
  if (!prev) return; // seed only, no event on first snapshot

  for (const side of ['left', 'right'] as const) {
    const wasOn = side === 'left' ? prev.left_on : prev.right_on;
    const isOn = side === 'left' ? next.left_on : next.right_on;
    if (wasOn !== isOn) {
      recordEvent(isOn ? 'power_on' : 'power_off', {
        side,
        payload: { isOn },
        source: 'collector/derive',
      });
    }
  }

  // Water: only emit on a real transition between known states.
  if (prev.water_ok !== next.water_ok && next.water_ok !== null) {
    recordEvent(next.water_ok ? 'water_ok' : 'water_low', {
      payload: { waterOk: next.water_ok },
      source: 'collector/derive',
    });
  }

  if (prev.is_priming !== next.is_priming) {
    recordEvent(next.is_priming ? 'prime_start' : 'prime_end', {
      payload: { isPriming: next.is_priming },
      source: 'collector/derive',
    });
  }
}

// --- Flush -----------------------------------------------------------------

// The single place that awaits the DB. Splices each queue and writes in one
// short transaction. All errors are swallowed (logged at warn) so a DB hiccup
// can never bubble into an unhandledRejection.
export async function flush(): Promise<void> {
  if (queuedRows() === 0) return;

  // SQLite's createMany does not support skipDuplicates, so dedup the batch
  // ourselves on the unique key ((side, timestamp) / timestamp). Two snapshots
  // inside the same wall-clock second would otherwise collide on that unique
  // index and fail the whole transaction. Last write in the second wins.
  const beds = dedupLast(bedQueue.splice(0, bedQueue.length), (r) => `${r.side}:${r.timestamp}`);
  const hubs = dedupLast(hubQueue.splice(0, hubQueue.length), (r) => `${r.timestamp}`);
  const events = eventQueue.splice(0, eventQueue.length);
  const audits = auditQueue.splice(0, auditQueue.length);

  try {
    const ops = [] as Array<ReturnType<typeof prisma.bed_state_samples.createMany>>;
    if (beds.length) {
      ops.push(prisma.bed_state_samples.createMany({ data: beds }));
    }
    if (hubs.length) {
      ops.push(prisma.hub_state_samples.createMany({ data: hubs }));
    }
    if (events.length) {
      ops.push(prisma.pod_events.createMany({ data: events }));
    }
    if (audits.length) {
      ops.push(prisma.config_audit.createMany({ data: audits }));
    }
    if (ops.length) {
      await prisma.$transaction(ops);
    }
  } catch (error) {
    // Do not requeue: a persistently failing row would grow the queue without
    // bound and re-fail every flush. Drop the batch and keep collecting.
    logger.warn(
      `[collector] flush dropped ${beds.length + hubs.length + events.length + audits.length} rows: ${errMsg(error)}`,
    );
  }
}

function maybeFlushBySize(): void {
  if (queuedRows() >= FLUSH_AT_ROWS) {
    void flush();
  }
}

// --- Retention -------------------------------------------------------------

/**
 * Prune rows older than the retention windows. Called by the daily retention
 * job (jobs/retentionJob.ts). Swallows and logs its own errors.
 */
export async function pruneOldRows(): Promise<void> {
  const now = nowSec();
  const bedHubCutoff = now - BED_HUB_RETENTION_DAYS * 24 * 60 * 60;
  const eventAuditCutoff = now - EVENT_AUDIT_RETENTION_DAYS * 24 * 60 * 60;
  try {
    const [bed, hub, events, audit] = await prisma.$transaction([
      prisma.bed_state_samples.deleteMany({ where: { timestamp: { lt: bedHubCutoff } } }),
      prisma.hub_state_samples.deleteMany({ where: { timestamp: { lt: bedHubCutoff } } }),
      prisma.pod_events.deleteMany({ where: { timestamp: { lt: eventAuditCutoff } } }),
      prisma.config_audit.deleteMany({ where: { timestamp: { lt: eventAuditCutoff } } }),
    ]);
    logger.info(
      `[collector] retention pruned bed=${bed.count} hub=${hub.count} events=${events.count} audit=${audit.count}`,
    );
  } catch (error) {
    logger.warn(`[collector] retention prune failed: ${errMsg(error)}`);
  }
}

// --- helpers ---------------------------------------------------------------

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Collapse rows sharing a unique key to the last one, preserving order.
function dedupLast<T>(rows: T[], keyOf: (row: T) => string): T[] {
  if (rows.length < 2) return rows;
  const byKey = new Map<string, T>();
  for (const row of rows) byKey.set(keyOf(row), row);
  return Array.from(byKey.values());
}

function numOrNull(n: number | null | undefined): number | null {
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

// Firmware level scale is the inverse of loadDeviceStatus.calculateTempInF /
// updateDeviceStatus.calculateLevelFromF: F = 82.5 + level/100 * 27.5.
// target_level stored alongside target_temp_f so callers can chart either.
function deriveTargetLevel(targetTemperatureF: number | null | undefined): number | null {
  if (typeof targetTemperatureF !== 'number' || !Number.isFinite(targetTemperatureF)) return null;
  return Math.round(((targetTemperatureF - 82.5) / 27.5) * 100);
}
