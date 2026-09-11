/** Calendar day ending at the run: includes pre-midnight sleep across DST. */
export function sleepAnalysisWindow(now) {
    return { startTime: now.clone().subtract(1, 'day').toISOString(), endTime: now.toISOString() };
}
//# sourceMappingURL=sleepAnalysisWindow.js.map