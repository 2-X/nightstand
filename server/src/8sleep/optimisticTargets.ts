// Shared registry of recently-set target temperatures that the UI should
// trust over polled franken snapshots until the firmware confirms them.
//
// Why: a physical button press sets a new target and we broadcast it to the
// UI immediately, but FrankenMonitor's 2s DEVICE_STATUS poll may already be
// in flight from BEFORE the press. That stale snapshot lands after the
// optimistic broadcast and flips the displayed target back for a poll cycle
// (observed live Sep 7 2026: set -> old -> set again). FrankenMonitor
// overlays fresh entries from this registry onto every polled snapshot, so a
// stale read can never regress a just-set value; once a poll shows franken
// agreeing, the entry is cleared and polling is authoritative again.
//
// The TTL bounds the damage if franken never confirms (e.g. a clamped or
// rejected value): after TTL_MS the polled truth wins unconditionally.
import { Side } from '../db/schedulesSchema.js';

const TTL_MS = 10_000;

interface Entry { f: number; at: number }
const entries: Partial<Record<Side, Entry>> = {};

export function setOptimisticTarget(side: Side, f: number): void {
  entries[side] = { f, at: Date.now() };
}

// The value the UI should see for this side right now, or null when polling
// is authoritative (no fresh entry).
export function getFreshOptimisticTarget(side: Side): number | null {
  const e = entries[side];
  if (!e) return null;
  if (Date.now() - e.at > TTL_MS) {
    delete entries[side];
    return null;
  }
  return e.f;
}

// Called by the poller when franken reports this target itself: the write
// round-tripped, polling is truth again.
export function confirmTarget(side: Side, polledF: number): void {
  const e = entries[side];
  if (e && e.f === polledF) delete entries[side];
}

export function clearAll(): void {
  delete entries.left;
  delete entries.right;
}
