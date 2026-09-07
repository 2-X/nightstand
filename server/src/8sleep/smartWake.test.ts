import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  SmartWakeSession,
  SmartWakeDeps,
  SmartWakeParams,
  SmartWakeSnapshot,
  VitalsSample,
  MovementBucket,
  SMART_WAKE_INTENSITY_STEPS,
  SMART_WAKE_GAP_SECONDS_STEPS,
  SMART_WAKE_UNKNOWN_GRACE_MS,
} from './smartWake.js';

// --- test harness ----------------------------------------------------------
//
// A fully synthetic deps object with an injected clock. The session reads
// whatever snapshot we set for the current tick; pulses / journal entries are
// captured for assertions. This exercises the pure decision logic without
// Prisma, franken, node-schedule, or the real clock.

type Journal = { event: string; payload: Record<string, unknown> };

class Harness {
  public nowMs: number;
  public snapshot: SmartWakeSnapshot;
  public dismissed = false;
  public armed = 0;
  public pulses: Array<{ intensity: number; durationS: number; atMs: number }> = [];
  public journal: Journal[] = [];
  public readThrows = false;

  constructor(startMs: number) {
    this.nowMs = startMs;
    this.snapshot = { vitals: [], movement: [], present: true, biometricsHealthy: true };
  }

  deps(): SmartWakeDeps {
    return {
      now: () => this.nowMs,
      readSnapshot: async () => {
        if (this.readThrows) throw new Error('boom');
        return this.snapshot;
      },
      pulse: async (intensity, durationS) => {
        this.pulses.push({ intensity, durationS, atMs: this.nowMs });
      },
      wasDismissed: () => this.dismissed,
      armVibe: async () => { this.armed += 1; },
      journal: (event, payload) => { this.journal.push({ event, payload }); },
    };
  }

  events(name: string): Journal[] {
    return this.journal.filter((j) => j.event === name);
  }
}

const MIN = 60_000;

// A deep-sleep snapshot: steady low HR near baseline, minimal movement, regular
// breathing. `t` is the current epoch-seconds "now" so the sample looks fresh.
function deepSnapshot(nowSec: number, hr = 50): SmartWakeSnapshot {
  const vitals: VitalsSample[] = [
    { timestamp: nowSec - 30, heart_rate: hr, hrv: 60, breathing_rate: 13 },
  ];
  const movement: MovementBucket[] = [
    { timestamp: nowSec - 60, total_movement: 5 },
  ];
  return { vitals, movement, present: true, biometricsHealthy: true };
}

// A light-sleep snapshot: elevated HR vs baseline + a movement spike.
function lightSnapshot(nowSec: number, hr: number, movement: number): SmartWakeSnapshot {
  return {
    vitals: [{ timestamp: nowSec - 20, heart_rate: hr, hrv: 55, breathing_rate: 15 }],
    movement: [{ timestamp: nowSec - 40, total_movement: movement }],
    present: true,
    biometricsHealthy: true,
  };
}

function makeParams(deadlineMs: number, windowMinutes = 30): SmartWakeParams {
  return { side: 'left', alarmId: 'a1', deadlineMs, windowMinutes };
}

describe('SmartWakeSession', () => {
  it('journals session_start and arms the vibrator on start', async () => {
    const start = Date.parse('2026-06-01T06:30:00Z');
    const deadline = start + 30 * MIN;
    const h = new Harness(start);
    const s = new SmartWakeSession(makeParams(deadline), h.deps());
    await s.start();
    assert.equal(h.armed, 1);
    assert.equal(h.events('session_start').length, 1);
  });

  it('holds nudges during deep sleep, then pulses once sleep lightens', async () => {
    const start = Date.parse('2026-06-01T06:30:00Z');
    const deadline = start + 30 * MIN;
    const h = new Harness(start);
    const s = new SmartWakeSession(makeParams(deadline), h.deps());
    await s.start();

    // First few ticks: deep. Seed a low HR baseline + low movement median.
    for (let i = 0; i < 4; i++) {
      const nowSec = Math.floor(h.nowMs / 1000);
      h.snapshot = deepSnapshot(nowSec, 50);
      const r = await s.tick();
      assert.equal(r.depth, 'deep', `tick ${i} should read deep`);
      assert.equal(r.decision, 'hold');
      h.nowMs += 30_000;
    }
    assert.equal(h.pulses.length, 0, 'no pulses fired during deep sleep');
    assert.ok(h.events('deep_hold').length >= 1, 'deep_hold journaled');

    // Now sleep lightens: HR rises well above the ~50 baseline AND a big
    // movement spike (median so far is ~5, so 40 is 8x).
    const nowSec = Math.floor(h.nowMs / 1000);
    h.snapshot = lightSnapshot(nowSec, 62, 40);
    const r = await s.tick();
    assert.equal(r.depth, 'light');
    assert.equal(r.decision, 'pulse');
    assert.equal(h.pulses.length, 1, 'a nudge pulse fired on lightening');
  });

  it('escalates intensity and gap across the window quarters', async () => {
    const start = Date.parse('2026-06-01T06:00:00Z');
    const windowMin = 40; // quarters at 0-10, 10-20, 20-30, 30-40 min
    const deadline = start + windowMin * MIN;
    const h = new Harness(start);
    const s = new SmartWakeSession(makeParams(deadline, windowMin), h.deps());
    await s.start();

    // Seed several deep ticks so the calm movement median + HR baseline are
    // well established (median is robust: a few later spikes won't move it).
    for (let i = 0; i < 6; i++) {
      h.snapshot = deepSnapshot(Math.floor(h.nowMs / 1000), 50);
      await s.tick();
      h.nowMs += 30_000;
    }

    // Sample the intensity chosen at the midpoint of each quarter by forcing a
    // LIGHT read and letting the gap elapse before each pulse. A dip back to
    // deep between quarters keeps the median low (the sleeper settles between
    // nudges), which is the realistic pattern.
    const midpoints = [5, 15, 25, 35]; // minutes into the window
    const gotIntensities: number[] = [];
    for (const minsIn of midpoints) {
      h.nowMs = start + minsIn * MIN;
      const nowSec = Math.floor(h.nowMs / 1000);
      h.snapshot = lightSnapshot(nowSec, 64, 40);
      const before = h.pulses.length;
      const r = await s.tick();
      assert.equal(r.decision, 'pulse', `expected a pulse at ${minsIn}m in`);
      assert.equal(h.pulses.length, before + 1);
      gotIntensities.push(h.pulses[h.pulses.length - 1].intensity);
      // Settle back to deep for a couple ticks before the next quarter.
      h.nowMs += 30_000;
      h.snapshot = deepSnapshot(Math.floor(h.nowMs / 1000), 50);
      await s.tick();
    }
    assert.deepEqual(gotIntensities, [...SMART_WAKE_INTENSITY_STEPS],
      'intensity should escalate 20->40->60->80 across quarters');
  });

  it('respects the per-quarter gap between pulses (UNKNOWN fallback)', async () => {
    // Use the biometrics-dead UNKNOWN-past-grace fallback to isolate the gap
    // mechanism: it nudges purely on the gap timer, with no woke-early spike
    // logic to interfere (there is no biometric signal at all).
    const start = Date.parse('2026-06-01T06:00:00Z');
    const windowMin = 40;
    const deadline = start + windowMin * MIN;
    const h = new Harness(start);
    const s = new SmartWakeSession(makeParams(deadline, windowMin), h.deps());
    await s.start();
    const dead: SmartWakeSnapshot = { vitals: [], movement: [], present: true, biometricsHealthy: false };

    // Anchor the unknown-grace window, then advance past it so nudging begins.
    h.snapshot = dead;
    await s.tick();
    h.nowMs += SMART_WAKE_UNKNOWN_GRACE_MS + 30_000;
    h.snapshot = dead;
    let r = await s.tick();
    assert.equal(r.decision, 'pulse', 'first fallback nudge fires past the grace window');
    const firstGap = SMART_WAKE_GAP_SECONDS_STEPS[0];

    h.nowMs += 30_000; // inside the 90s first-quarter gap
    h.snapshot = dead;
    r = await s.tick();
    assert.equal(r.decision, 'wait', 'should wait inside the gap');

    h.nowMs += (firstGap * 1000); // now past the gap
    h.snapshot = dead;
    r = await s.tick();
    assert.equal(r.decision, 'pulse', 'should pulse again after the gap');
  });

  it('all-deep night fires no nudges and ends at the deadline', async () => {
    const start = Date.parse('2026-06-01T06:30:00Z');
    const deadline = start + 30 * MIN;
    const h = new Harness(start);
    const s = new SmartWakeSession(makeParams(deadline), h.deps());
    await s.start();

    // Tick every 30s across the whole window; always deep.
    while (h.nowMs < deadline) {
      h.snapshot = deepSnapshot(Math.floor(h.nowMs / 1000), 50);
      await s.tick();
      h.nowMs += 30_000;
    }
    // One more tick at/after the deadline ends the session.
    const r = await s.tick();
    assert.equal(r.outcome, 'deadline_reached');
    assert.equal(h.pulses.length, 0, 'no nudges on an all-deep night');
    assert.ok(s.isEnded());
    const end = h.events('session_end');
    assert.equal(end[0].payload.outcome, 'deadline_reached');
  });

  it('ends woke_early when the alarm is dismissed', async () => {
    const start = Date.parse('2026-06-01T06:30:00Z');
    const deadline = start + 30 * MIN;
    const h = new Harness(start);
    const s = new SmartWakeSession(makeParams(deadline), h.deps());
    await s.start();
    h.snapshot = deepSnapshot(Math.floor(h.nowMs / 1000), 50);
    await s.tick();

    h.dismissed = true;
    h.nowMs += 30_000;
    const r = await s.tick();
    assert.equal(r.outcome, 'woke_early');
    assert.equal(h.events('woke_early')[0].payload.how, 'dismissed');
    assert.ok(s.isEnded());
  });

  it('ends woke_early on presence exit', async () => {
    const start = Date.parse('2026-06-01T06:30:00Z');
    const deadline = start + 30 * MIN;
    const h = new Harness(start);
    const s = new SmartWakeSession(makeParams(deadline), h.deps());
    await s.start();
    h.snapshot = { ...deepSnapshot(Math.floor(h.nowMs / 1000), 50), present: false };
    const r = await s.tick();
    assert.equal(r.outcome, 'woke_early');
    assert.equal(h.events('woke_early')[0].payload.how, 'presence_exit');
  });

  it('ends woke_early on a sustained movement+HR spike over 2 ticks', async () => {
    const start = Date.parse('2026-06-01T06:30:00Z');
    const deadline = start + 30 * MIN;
    const h = new Harness(start);
    const s = new SmartWakeSession(makeParams(deadline), h.deps());
    await s.start();
    // Seed baseline low HR + low movement median.
    for (let i = 0; i < 3; i++) {
      h.snapshot = deepSnapshot(Math.floor(h.nowMs / 1000), 50);
      await s.tick();
      h.nowMs += 30_000;
    }
    // Two consecutive ticks with both a movement spike and a HR rise.
    h.snapshot = lightSnapshot(Math.floor(h.nowMs / 1000), 60, 30);
    let r = await s.tick();
    assert.notEqual(r.outcome, 'woke_early', 'one spike tick is not enough');
    h.nowMs += 30_000;
    h.snapshot = lightSnapshot(Math.floor(h.nowMs / 1000), 60, 30);
    r = await s.tick();
    assert.equal(r.outcome, 'woke_early');
    assert.equal(h.events('woke_early')[0].payload.how, 'movement_hr_sustained');
  });

  it('biometrics-dead: stays UNKNOWN then nudges after the grace window', async () => {
    const start = Date.parse('2026-06-01T06:00:00Z');
    const deadline = start + 40 * MIN;
    const h = new Harness(start);
    const s = new SmartWakeSession(makeParams(deadline, 40), h.deps());
    await s.start();

    // Stream unhealthy => depth UNKNOWN regardless of rows. No nudge before the
    // grace window elapses.
    h.snapshot = { vitals: [], movement: [], present: true, biometricsHealthy: false };
    let r = await s.tick();
    assert.equal(r.depth, 'unknown');
    assert.equal(r.decision, 'wait', 'no nudge inside the unknown grace window');
    assert.equal(h.pulses.length, 0);

    // Advance past the grace window; UNKNOWN now nudges as a fallback.
    h.nowMs += SMART_WAKE_UNKNOWN_GRACE_MS + 30_000;
    h.snapshot = { vitals: [], movement: [], present: true, biometricsHealthy: false };
    r = await s.tick();
    assert.equal(r.depth, 'unknown');
    assert.equal(r.decision, 'pulse', 'UNKNOWN past grace falls back to nudging');
    assert.equal(h.pulses.length, 1);
  });

  it('treats stale vitals as UNKNOWN even when the stream reports healthy', async () => {
    const start = Date.parse('2026-06-01T06:00:00Z');
    const deadline = start + 40 * MIN;
    const h = new Harness(start);
    const s = new SmartWakeSession(makeParams(deadline, 40), h.deps());
    await s.start();
    // Row is 10 minutes old => stale (> 5 min), so depth is UNKNOWN.
    const nowSec = Math.floor(h.nowMs / 1000);
    h.snapshot = {
      vitals: [{ timestamp: nowSec - 600, heart_rate: 50, hrv: 60, breathing_rate: 13 }],
      movement: [{ timestamp: nowSec - 600, total_movement: 5 }],
      present: true,
      biometricsHealthy: true,
    };
    const r = await s.tick();
    assert.equal(r.depth, 'unknown');
  });

  it('degrades to UNKNOWN wait when readSnapshot throws', async () => {
    const start = Date.parse('2026-06-01T06:00:00Z');
    const deadline = start + 30 * MIN;
    const h = new Harness(start);
    const s = new SmartWakeSession(makeParams(deadline), h.deps());
    await s.start();
    h.readThrows = true;
    const r = await s.tick();
    assert.equal(r.depth, 'unknown');
    assert.equal(r.decision, 'wait');
    assert.equal(h.pulses.length, 0);
    assert.equal(s.isEnded(), false, 'a read failure must not end the session');
  });

  it('a tick at/after the deadline ends the session without pulsing', async () => {
    const start = Date.parse('2026-06-01T06:30:00Z');
    const deadline = start + 30 * MIN;
    const h = new Harness(start);
    const s = new SmartWakeSession(makeParams(deadline), h.deps());
    await s.start();
    h.nowMs = deadline; // exactly at the deadline
    const r = await s.tick();
    assert.equal(r.outcome, 'deadline_reached');
    assert.equal(h.pulses.length, 0);
  });
});
