export function buildCalibrationView(profile, lastRun) {
    if (profile === null) {
        return {
            state: 'none',
            summary: 'Not calibrated yet. This happens automatically once the sensors record a stretch of empty bed.',
            quality: null,
            calibratedAt: null,
            lastRunStatus: lastRun?.status ?? null,
        };
    }
    // An imported profile and a genuinely thin one both carry quality 0. Only
    // the trigger separates them, and describing a carry-over as poor would
    // assert a measurement that was never taken.
    if (lastRun?.trigger === 'migration') {
        return {
            state: 'imported',
            summary: 'Carried over from an earlier version, confidence unknown.',
            quality: null,
            calibratedAt: profile.created_at,
            lastRunStatus: lastRun.status,
        };
    }
    const windowMinutes = Math.round((profile.source_end - profile.source_start) / 60);
    return {
        state: 'calibrated',
        summary: `Learned from a ${windowMinutes} min empty-bed window.`,
        quality: profile.quality,
        calibratedAt: profile.created_at,
        lastRunStatus: lastRun?.status ?? null,
    };
}
//# sourceMappingURL=calibrationView.js.map