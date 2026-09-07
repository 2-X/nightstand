// Sleep Cycle-style smart wake session state machine (per side, per alarm).
//
// This module is deliberately PURE and fully dependency-injected: it holds no
// imports of Prisma, node-schedule, franken, or the clock. Everything it
// touches - reading biometrics, firing a pulse, reading dismissal state,
// journaling, arming the vibrator, the current time - arrives through the
// `SmartWakeDeps` interface. That makes the whole decision logic unit-testable
// with a fake clock + synthetic vitals, and keeps this file free of any
// side effect that could throw into an unhandled rejection.
//
// The controller (smartWakeController.ts) wires the production deps and owns
// the setInterval; this file only decides.
//
// HARD GUARANTEE (enforced structurally elsewhere): the deadline alarm at
// alarmTime is scheduled as its own independent node-schedule job in
// alarmScheduler.ts. Nothing in this session can cancel, delay, or replace it.
// A crashed/ended session simply stops adding early nudges; the deadline still
// fires the full configured vibration. See the deadline-independence test.

// --- Tunable escalation parameters (shipped values) ------------------------
//
// The window is divided into four equal quarters. As the session advances
// through the window undissmissed, nudges get stronger and the gaps between
// them get shorter, so the earliest nudges are barely perceptible and the last
// ones approach the real alarm. These are the "exact escalation parameters
// shipped" - watch the smart_wake journal and tune here.
export const SMART_WAKE_INTENSITY_STEPS = [20, 40, 60, 80] as const;
export const SMART_WAKE_GAP_SECONDS_STEPS = [90, 60, 40, 25] as const;
// Each nudge is a short self-clearing pulse (buttonMonitor.maybeHaptic style):
// a brief buzz, not a sustained alarm. Duration in seconds sent as `du`.
export const SMART_WAKE_PULSE_DURATION_S = 3;
// The controller ticks about this often. Exposed so the scheduler / controller
// and the tests agree on cadence.
export const SMART_WAKE_TICK_MS = 30_000;
// Biometric freshness: a vitals sample older than this is not trustworthy for
// a depth estimate.
export const SMART_WAKE_STALE_VITALS_MS = 5 * 60_000;
// If depth stays UNKNOWN for longer than this into the window, stop waiting for
// good data and treat it like LIGHT so the sleeper still gets gentle nudges
// before the deadline (better than silence when biometrics are dead).
export const SMART_WAKE_UNKNOWN_GRACE_MS = 5 * 60_000;
// Wake-by-biometrics needs a sustained signal, not a single twitch: a movement
// spike AND a HR rise for at least this many consecutive ticks.
export const SMART_WAKE_WOKE_TICKS = 2;
// A movement bucket this many multiples above the night's median counts as a
// "spike" for wake detection / lighter-sleep signal.
export const SMART_WAKE_MOVEMENT_SPIKE_FACTOR = 2.0;
// HR this many bpm above the session's rolling baseline counts as a "rise".
export const SMART_WAKE_HR_RISE_BPM = 3;

export type SmartWakeDepth = 'light' | 'deep' | 'unknown';

export type SmartWakeOutcome =
  | 'woke_early'
  | 'deadline_reached'
  | 'aborted';

// A single vitals sample as this module needs it. hrv 0 is the "no reading"
// sentinel (docs/DATA.md); breathing_rate 0 likewise means no reading.
export type VitalsSample = {
  timestamp: number; // epoch seconds
  heart_rate: number | null;
  hrv: number | null;
  breathing_rate: number | null;
};

// A movement bucket (2-min) total. Higher = more restless.
export type MovementBucket = {
  timestamp: number; // epoch seconds
  total_movement: number;
};

// The freshest observable state, gathered by the controller each tick. The
// session never fetches anything itself.
export type SmartWakeSnapshot = {
  // Most-recent-first is not required; the session sorts / picks the newest.
  vitals: VitalsSample[];
  movement: MovementBucket[];
  // Live presence for the side (GET /api/metrics/presence). null = unknown.
  present: boolean | null;
  // Whether the biometrics Python stream is healthy right now. When false we
  // cannot trust vitals freshness regardless of row timestamps.
  biometricsHealthy: boolean;
};

export type SmartWakeJournalEvent =
  | 'session_start'
  | 'tick'
  | 'pulse'
  | 'deep_hold'
  | 'woke_early'
  | 'session_end';

export type SmartWakeDeps = {
  now: () => number; // epoch ms
  // Gather the freshest biometrics/presence snapshot. Never throws (controller
  // catches); returns best-effort.
  readSnapshot: () => Promise<SmartWakeSnapshot>;
  // Fire one self-clearing nudge pulse: intensity 1..100, duration seconds.
  pulse: (intensity: number, durationS: number) => Promise<void>;
  // True if an alarm dismissal happened since this session started. The
  // controller wires this to the same updateDeviceStatus({isAlarmVibrating:
  // false}) path the middle button and the app use, so a groggy tap on the
  // cover during a nudge ends the session as woke_early. A nudge pulse
  // self-clears without ever flipping memoryDB.isAlarmVibrating true, so this
  // is a session-scoped "dismiss seen" flag, not a live read of the bit.
  wasDismissed: () => boolean;
  // Best-effort arm of the pod vibrator before the first pulse. Idempotent,
  // silent no-op on local dev.
  armVibe: () => Promise<void>;
  // Journal a smart_wake event. Fire-and-forget (recordEvent is synchronous).
  journal: (event: SmartWakeJournalEvent, payload: Record<string, unknown>) => void;
};

export type SmartWakeParams = {
  side: 'left' | 'right';
  alarmId: string;
  // Absolute deadline instant (alarm time) in epoch ms.
  deadlineMs: number;
  windowMinutes: number;
};

// Internal per-tick depth + decision, returned for tests to assert on.
export type TickResult = {
  depth: SmartWakeDepth;
  decision: 'pulse' | 'hold' | 'wait' | 'woke_early' | 'done';
  intensity?: number;
  outcome?: SmartWakeOutcome;
};

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * One smart-wake session. Constructed at window start; `tick()` is called by
 * the controller every ~30s until it returns a terminal decision.
 *
 * The session is single-threaded by construction: the controller guards
 * against overlapping ticks (in-flight flag) exactly like buttonMonitor.
 */
export class SmartWakeSession {
  private readonly deps: SmartWakeDeps;
  private readonly params: SmartWakeParams;

  private started = false;
  private ended = false;
  private startedAtMs = 0;
  private lastPulseAtMs = 0;

  // Rolling baselines seeded from the session's own observations. HR baseline
  // is the minimum HR seen so far (the calmest = deepest reading), which the
  // "HR rise" signal measures against. Movement median is over the buckets
  // seen this session.
  private hrBaseline: number | null = null;
  private hrSamples: number[] = [];
  private movementSamples: number[] = [];
  private brSamples: number[] = [];

  // Consecutive ticks where both a movement spike and an HR rise were seen.
  private wokeSignalTicks = 0;
  // First tick timestamp at which depth was UNKNOWN, to apply the grace window.
  private firstUnknownAtMs: number | null = null;

  constructor(params: SmartWakeParams, deps: SmartWakeDeps) {
    this.params = params;
    this.deps = deps;
  }

  public isEnded(): boolean {
    return this.ended;
  }

  /**
   * Begin the session: arm the vibrator (best effort) and journal the start.
   * Idempotent. Kept separate from the constructor so the controller can await
   * the arm before the first tick.
   */
  public async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.startedAtMs = this.deps.now();
    try {
      await this.deps.armVibe();
    } catch {
      // armVibe is best-effort; never let it abort the session.
    }
    this.deps.journal('session_start', {
      side: this.params.side,
      alarmId: this.params.alarmId,
      deadlineMs: this.params.deadlineMs,
      windowMinutes: this.params.windowMinutes,
      startedAtMs: this.startedAtMs,
    });
  }

  /**
   * Advance the session by one tick. Returns the decision it made this tick.
   * Never throws: any dep failure degrades gracefully to a 'wait'.
   */
  public async tick(): Promise<TickResult> {
    if (this.ended) return { depth: 'unknown', decision: 'done' };
    const nowMs = this.deps.now();

    // 1) Deadline reached? The session's job is done once we're at/after the
    //    deadline - the independent deadline alarm job owns the actual wake
    //    from here. End cleanly so we stop nudging on top of the real alarm.
    if (nowMs >= this.params.deadlineMs) {
      this.end('deadline_reached');
      return { depth: 'unknown', decision: 'done', outcome: 'deadline_reached' };
    }

    // 2) Explicit dismissal (button/app) since the session started => awake.
    //    Same path the middle cover button and the app use.
    if (this.deps.wasDismissed()) {
      this.deps.journal('woke_early', {
        side: this.params.side,
        alarmId: this.params.alarmId,
        how: 'dismissed',
        atMs: nowMs,
      });
      this.end('woke_early');
      return { depth: 'unknown', decision: 'woke_early', outcome: 'woke_early' };
    }

    let snap: SmartWakeSnapshot;
    try {
      snap = await this.deps.readSnapshot();
    } catch {
      // Could not read biometrics: treat as UNKNOWN depth, no data updates.
      // Anchor the unknown-grace window so a persistent read failure still
      // falls back to nudging after the grace period.
      if (this.firstUnknownAtMs === null) this.firstUnknownAtMs = nowMs;
      return this.decideWithDepth(
        'unknown', nowMs, null, null, null,
        median(this.movementSamples), this.hrBaseline,
      );
    }

    // 3) Presence exit = they got out of bed = awake. Strongest wake signal.
    if (snap.present === false) {
      this.deps.journal('woke_early', {
        side: this.params.side,
        alarmId: this.params.alarmId,
        how: 'presence_exit',
        atMs: nowMs,
      });
      this.end('woke_early');
      return { depth: 'unknown', decision: 'woke_early', outcome: 'woke_early' };
    }

    // Pick the freshest vitals sample and freshest movement bucket.
    const freshVital = this.freshestVital(snap.vitals);
    const freshMove = this.freshestMovement(snap.movement);

    const vitalsFresh =
      snap.biometricsHealthy &&
      freshVital !== null &&
      nowMs - freshVital.timestamp * 1000 <= SMART_WAKE_STALE_VITALS_MS;

    // Snapshot the PRIOR baselines (the night so far, excluding this reading)
    // BEFORE folding the current sample in. Comparing the current reading
    // against a baseline that already includes it would blunt every spike -
    // the whole point is "is *this* reading elevated vs the calm baseline".
    const priorMovementMedian = median(this.movementSamples);
    const priorHrBaseline = this.hrBaseline;

    // Extract usable current readings (only when the stream is healthy, so a
    // dead stream's frozen last row doesn't poison baselines).
    let hr: number | null = null;
    let movementVal: number | null = null;
    let br: number | null = null;
    if (vitalsFresh && freshVital) {
      hr = typeof freshVital.heart_rate === 'number' && freshVital.heart_rate > 0
        ? freshVital.heart_rate : null;
      br = typeof freshVital.breathing_rate === 'number' && freshVital.breathing_rate > 0
        ? freshVital.breathing_rate : null;
    }
    if (freshMove !== null) movementVal = freshMove.total_movement;

    const depth = this.estimateDepth(
      vitalsFresh, hr, movementVal, br, nowMs, priorMovementMedian, priorHrBaseline,
    );
    const result = this.decideWithDepth(
      depth, nowMs, hr, movementVal, br, priorMovementMedian, priorHrBaseline,
    );

    // Fold this reading into the rolling baselines AFTER deciding, so the next
    // tick compares against a baseline that now includes it.
    if (hr !== null) {
      this.hrSamples.push(hr);
      this.hrBaseline = this.hrBaseline === null ? hr : Math.min(this.hrBaseline, hr);
    }
    if (br !== null) this.brSamples.push(br);
    if (movementVal !== null) this.movementSamples.push(movementVal);

    return result;
  }

  // --- depth estimation ----------------------------------------------------

  private estimateDepth(
    vitalsFresh: boolean,
    hr: number | null,
    movementVal: number | null,
    br: number | null,
    nowMs: number,
    priorMovementMedian: number | null,
    priorHrBaseline: number | null,
  ): SmartWakeDepth {
    if (!vitalsFresh) {
      if (this.firstUnknownAtMs === null) this.firstUnknownAtMs = nowMs;
      return 'unknown';
    }
    // We have fresh data: clear the unknown-grace anchor.
    this.firstUnknownAtMs = null;

    // Not enough history yet to have a baseline to judge against: hold (DEEP)
    // rather than nudging on the very first reading of the night.
    if (priorMovementMedian === null && priorHrBaseline === null) return 'deep';

    const movementElevated =
      movementVal !== null && priorMovementMedian !== null && priorMovementMedian > 0 &&
      movementVal >= priorMovementMedian * SMART_WAKE_MOVEMENT_SPIKE_FACTOR;

    // HR rising above the session's calmest baseline is a lighter-sleep sign.
    const hrElevated =
      hr !== null && priorHrBaseline !== null &&
      hr >= priorHrBaseline + SMART_WAKE_HR_RISE_BPM;

    // Breathing-rate variability: a widening spread across the session's
    // samples is a lighter-sleep sign (deep sleep = very regular breathing).
    const brVariable = this.breathingVariable();

    // Any two of the three lighter-sleep signals => LIGHT. One alone is weak.
    const lightVotes = [movementElevated, hrElevated, brVariable].filter(Boolean).length;
    if (lightVotes >= 2) return 'light';
    // A strong single movement spike on its own also reads as LIGHT.
    if (movementElevated && priorMovementMedian !== null && movementVal !== null &&
        movementVal >= priorMovementMedian * (SMART_WAKE_MOVEMENT_SPIKE_FACTOR * 1.5)) {
      return 'light';
    }
    return 'deep';
  }

  private breathingVariable(): boolean {
    if (this.brSamples.length < 4) return false;
    const m = median(this.brSamples);
    if (m === null || m <= 0) return false;
    // Mean absolute deviation as a fraction of median. Deep sleep breathing is
    // metronomic; > ~12% relative MAD is "variable".
    const mad = this.brSamples.reduce((acc, v) => acc + Math.abs(v - m), 0) / this.brSamples.length;
    return mad / m >= 0.12;
  }

  // --- decision ------------------------------------------------------------

  private decideWithDepth(
    depth: SmartWakeDepth,
    nowMs: number,
    hr: number | null,
    movementVal: number | null,
    br: number | null,
    priorMovementMedian: number | null,
    priorHrBaseline: number | null,
  ): TickResult {
    // Sustained wake heuristic: movement spike AND HR rise for 2+ ticks. Both
    // measured against the PRIOR baseline (excluding this reading), same as
    // depth estimation.
    const movementSpike =
      movementVal !== null && priorMovementMedian !== null && priorMovementMedian > 0 &&
      movementVal >= priorMovementMedian * SMART_WAKE_MOVEMENT_SPIKE_FACTOR;
    const hrRise =
      hr !== null && priorHrBaseline !== null &&
      hr >= priorHrBaseline + SMART_WAKE_HR_RISE_BPM;
    if (movementSpike && hrRise) {
      this.wokeSignalTicks += 1;
    } else {
      this.wokeSignalTicks = 0;
    }
    if (this.wokeSignalTicks >= SMART_WAKE_WOKE_TICKS) {
      this.deps.journal('woke_early', {
        side: this.params.side,
        alarmId: this.params.alarmId,
        how: 'movement_hr_sustained',
        atMs: nowMs,
        ticks: this.wokeSignalTicks,
      });
      this.end('woke_early');
      return { depth, decision: 'woke_early', outcome: 'woke_early' };
    }

    // Whether we should nudge this tick: LIGHT, or UNKNOWN past the grace
    // window (biometrics dead - fall back to gentle nudging rather than
    // silence). DEEP => hold and re-evaluate next tick.
    const unknownPastGrace =
      depth === 'unknown' &&
      this.firstUnknownAtMs !== null &&
      nowMs - this.firstUnknownAtMs >= SMART_WAKE_UNKNOWN_GRACE_MS;

    // Science-driven wake policy (see PLAN.md smart wake notes):
    //
    // COMMITTED: once the first pulse has fired, escalation runs to
    // completion regardless of later depth readings. Scattered sub-waking
    // pulses that start and stop fragment the final REM without waking
    // anyone - worse than either finishing the wake or never starting.
    //
    // PASSIVE first half: the last sleep cycles are REM-rich and doing real
    // work (emotional regulation, memory consolidation); waking at the first
    // light-sleep moment costs up to windowMinutes of it. In the first half
    // of the window we only ride a NATURAL arousal - a genuine movement
    // spike. REM atonia means REM can never produce one, so this gate also
    // prevents nudging into valuable REM that the coarse depth heuristic
    // could misread as LIGHT (HR/breathing variability without movement).
    //
    // ACTIVE second half: shipped behavior - nudge on LIGHT, or on UNKNOWN
    // past the grace period (biometrics dead => gentle fallback beats
    // silence).
    const committed = this.lastPulseAtMs !== 0;
    const windowMs = this.params.windowMinutes * 60_000;
    const inFirstHalf = windowMs > 0 && nowMs < this.params.deadlineMs - windowMs / 2;
    const phase = committed ? 'committed' : (inFirstHalf ? 'passive' : 'active');

    let shouldNudge: boolean;
    if (committed) {
      shouldNudge = true;
    } else if (inFirstHalf) {
      shouldNudge = depth === 'light' && movementSpike;
    } else {
      shouldNudge = depth === 'light' || unknownPastGrace;
    }

    this.deps.journal('tick', {
      side: this.params.side,
      alarmId: this.params.alarmId,
      atMs: nowMs,
      depth,
      decision: shouldNudge ? 'pulse' : (depth === 'deep' ? 'hold' : 'wait'),
      phase,
      hr,
      movement: movementVal,
      breathingRate: br,
      hrBaseline: priorHrBaseline,
      movementMedian: priorMovementMedian,
    });

    if (!shouldNudge) {
      if (depth === 'deep') {
        this.deps.journal('deep_hold', {
          side: this.params.side,
          alarmId: this.params.alarmId,
          atMs: nowMs,
        });
        return { depth, decision: 'hold' };
      }
      return { depth, decision: 'wait' };
    }

    // Respect the gap for the current escalation quarter.
    const intensity = this.currentIntensity(nowMs);
    const gapS = this.currentGapSeconds(nowMs);
    if (this.lastPulseAtMs !== 0 && nowMs - this.lastPulseAtMs < gapS * 1000) {
      // Still inside the gap since the last pulse; wait.
      return { depth, decision: 'wait' };
    }

    this.firePulse(intensity, nowMs);
    return { depth, decision: 'pulse', intensity };
  }

  private firePulse(intensity: number, nowMs: number): void {
    this.lastPulseAtMs = nowMs;
    // Fire-and-forget: the pulse is best-effort; a failed pulse must not abort
    // the session (the deadline alarm is the real guarantee). Its own rejection
    // is swallowed so it can never escape as an unhandled rejection.
    void this.deps.pulse(intensity, SMART_WAKE_PULSE_DURATION_S).catch(() => undefined);
    this.deps.journal('pulse', {
      side: this.params.side,
      alarmId: this.params.alarmId,
      atMs: nowMs,
      intensity,
      durationS: SMART_WAKE_PULSE_DURATION_S,
    });
  }

  // Which quarter of the window are we in (0..3), by elapsed fraction.
  private windowQuarter(nowMs: number): number {
    const windowMs = this.params.windowMinutes * 60_000;
    const startMs = this.params.deadlineMs - windowMs;
    const elapsed = nowMs - startMs;
    if (windowMs <= 0) return SMART_WAKE_INTENSITY_STEPS.length - 1;
    const frac = Math.max(0, Math.min(0.999, elapsed / windowMs));
    const q = Math.floor(frac * SMART_WAKE_INTENSITY_STEPS.length);
    return Math.max(0, Math.min(SMART_WAKE_INTENSITY_STEPS.length - 1, q));
  }

  private currentIntensity(nowMs: number): number {
    return SMART_WAKE_INTENSITY_STEPS[this.windowQuarter(nowMs)];
  }

  private currentGapSeconds(nowMs: number): number {
    return SMART_WAKE_GAP_SECONDS_STEPS[this.windowQuarter(nowMs)];
  }

  // --- helpers -------------------------------------------------------------

  private freshestVital(vitals: VitalsSample[]): VitalsSample | null {
    let best: VitalsSample | null = null;
    for (const v of vitals) {
      if (best === null || v.timestamp > best.timestamp) best = v;
    }
    return best;
  }

  private freshestMovement(movement: MovementBucket[]): MovementBucket | null {
    let best: MovementBucket | null = null;
    for (const m of movement) {
      if (best === null || m.timestamp > best.timestamp) best = m;
    }
    return best;
  }

  private end(outcome: SmartWakeOutcome): void {
    if (this.ended) return;
    this.ended = true;
    this.deps.journal('session_end', {
      side: this.params.side,
      alarmId: this.params.alarmId,
      outcome,
      atMs: this.deps.now(),
    });
  }

  /**
   * Externally abort the session (e.g. the alarm was deleted, side went into
   * away mode, or the controller is shutting down). Journals 'aborted'.
   */
  public abort(): void {
    this.end('aborted');
  }
}
