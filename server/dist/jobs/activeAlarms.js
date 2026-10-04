export const activeAlarms = new Map();
const snoozes = new Map();
export function hasSnooze(side) {
    return snoozes.has(side);
}
export function cancelSnooze(side) {
    clearTimeout(snoozes.get(side));
    snoozes.delete(side);
}
// Replaces any snooze already waiting on this side.
export function setSnooze(side, delayMs, ring) {
    cancelSnooze(side);
    const timer = setTimeout(() => {
        if (snoozes.get(side) !== timer)
            return;
        snoozes.delete(side);
        ring();
    }, delayMs);
    snoozes.set(side, timer);
}
// A dismissed alarm also ends its snooze.
export function forgetActiveAlarm(side) {
    activeAlarms.delete(side);
    cancelSnooze(side);
}
//# sourceMappingURL=activeAlarms.js.map