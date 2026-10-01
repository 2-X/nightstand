export type CalibrationProfileRow = {
  quality: number;
  source_start: number;
  source_end: number;
  created_at: number;
};

export type CalibrationRunRow = {
  status: string;
  trigger: string;
};

export type CalibrationFormatRow = {
  payload: string | null;
};

// With the new sleep tracking on, each capacitance calibration run records
// the record format the Pod writes, such as capSense2 or capSense. A run that
// saw no usable records records 'none' or 'unknown', which name no format.
export function capFormatOf(run: CalibrationFormatRow | null): string | null {
  if (!run?.payload) return null;
  try {
    const parsed: unknown = JSON.parse(run.payload);
    const format = typeof parsed === 'object' && parsed !== null ? (parsed as { format?: unknown }).format : undefined;
    if (typeof format !== 'string' || format.length === 0 || format.length > 64) return null;
    return format === 'none' || format === 'unknown' ? null : format;
  } catch {
    return null;
  }
}

// The newest run that names a format, so a later empty-window run does not
// erase a good label. Runs come newest first.
export function newestFormatRun(runs: CalibrationFormatRow[]): CalibrationFormatRow | null {
  return runs.find((run) => capFormatOf(run) !== null) ?? null;
}

export type CalibrationView = {
  state: 'none' | 'imported' | 'calibrated';
  summary: string;
  quality: number | null;
  calibratedAt: number | null;
  lastRunStatus: string | null;
  capFormat: string | null;
};

export function buildCalibrationView(
  profile: CalibrationProfileRow | null,
  originatingRun: CalibrationRunRow | null,
  lastRun: CalibrationRunRow | null,
  formatRun: CalibrationFormatRow | null = null,
): CalibrationView {
  if (profile === null) {
    return {
      state: 'none',
      summary: 'Not calibrated yet. This happens automatically once the sensors record a stretch of empty bed.',
      quality: null,
      calibratedAt: null,
      lastRunStatus: lastRun?.status ?? null,
      capFormat: capFormatOf(formatRun),
    };
  }

  // An imported profile and a genuinely thin one both carry quality 0. Only
  // the trigger of the run that produced THIS profile (originatingRun, keyed
  // off profile.run_id) separates them. A later run of any kind, unrelated to
  // this profile, must not flip that: describing a carry-over as poor would
  // assert a measurement that was never taken.
  if (originatingRun?.trigger === 'migration') {
    return {
      state: 'imported',
      summary: 'Carried over from an earlier version, confidence unknown.',
      quality: null,
      calibratedAt: profile.created_at,
      lastRunStatus: lastRun?.status ?? null,
      capFormat: capFormatOf(formatRun),
    };
  }

  const windowMinutes = Math.round((profile.source_end - profile.source_start) / 60);
  return {
    state: 'calibrated',
    summary: `Learned from a ${windowMinutes} min empty-bed window.`,
    quality: profile.quality,
    calibratedAt: profile.created_at,
    lastRunStatus: lastRun?.status ?? null,
    capFormat: capFormatOf(formatRun),
  };
}
