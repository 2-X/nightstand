const TTL_MS = 10_000;
const entries = {};
export function setOptimisticTarget(side, f) {
    entries[side] = { f, at: Date.now() };
}
// The value the UI should see for this side right now, or null when polling
// is authoritative (no fresh entry).
export function getFreshOptimisticTarget(side) {
    const e = entries[side];
    if (!e)
        return null;
    if (Date.now() - e.at > TTL_MS) {
        delete entries[side];
        return null;
    }
    return e.f;
}
// Called by the poller when franken reports this target itself: the write
// round-tripped, polling is truth again.
export function confirmTarget(side, polledF) {
    const e = entries[side];
    if (e && e.f === polledF)
        delete entries[side];
}
export function clearAll() {
    delete entries.left;
    delete entries.right;
}
//# sourceMappingURL=optimisticTargets.js.map