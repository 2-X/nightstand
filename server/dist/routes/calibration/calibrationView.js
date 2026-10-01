// With the new sleep tracking on, each capacitance calibration run records
// the record format the Pod writes, such as capSense2 or capSense. A run that
// saw no usable records records 'none' or 'unknown', which name no format.
export function capFormatOf(run) {
    if (!run?.payload)
        return null;
    try {
        const parsed = JSON.parse(run.payload);
        const format = typeof parsed === 'object' && parsed !== null ? parsed.format : undefined;
        if (typeof format !== 'string' || format.length === 0 || format.length > 64)
            return null;
        return format === 'none' || format === 'unknown' ? null : format;
    }
    catch {
        return null;
    }
}
// The newest run that names a format, so a later empty-window run does not
// erase a good label. Runs come newest first.
export function newestFormatRun(runs) {
    return runs.find((run) => capFormatOf(run) !== null) ?? null;
}
export function buildCalibrationView(profile, originatingRun, lastRun, formatRun = null) {
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
//# sourceMappingURL=calibrationView.js.map