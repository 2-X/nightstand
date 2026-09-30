// Pulled out so this precondition is unit-testable without spinning up the
// route. `deepPartial()`-parsed POST /settings bodies only carry
// `features.levelTemps` when the caller is actually changing it, so an
// explicit `=== false` (not just falsy/absent) is the signal that the flag
// was flipped off. The effective format is the update's own value if the
// same request also changes it, otherwise whatever is already stored, so a
// single request that both disables the flag and switches the format away
// from level is allowed.
export function wouldOrphanLevelFormat(current, update) {
    const disabling = update.features?.levelTemps === false;
    const effectiveFormat = update.temperatureFormat ?? current.temperatureFormat;
    return disabling && effectiveFormat === 'level';
}
export const MAX_PAUSE_MS = 14 * 24 * 60 * 60 * 1000;
// Checks the pause each side would have after this update is merged, so a
// partial update is judged against the stored values it keeps. Resuming is
// always allowed.
export function pauseRejection(current, update, now) {
    for (const side of ['left', 'right']) {
        const change = update[side]?.scheduleOverrides?.pause;
        if (!change)
            continue;
        const pause = { ...current[side].scheduleOverrides.pause, ...change };
        if (!pause.active)
            continue;
        if (update[side]?.awayMode ?? current[side].awayMode) {
            return 'Turn off away mode before pausing this side\'s schedule';
        }
        if (!pause.expiresAt)
            continue;
        const end = Date.parse(pause.expiresAt);
        if (!(end > now.getTime()))
            return 'Choose a pause end time in the future';
        if (end - now.getTime() > MAX_PAUSE_MS)
            return 'A pause can end at most 14 days from now';
    }
    return null;
}
//# sourceMappingURL=settingsGuards.js.map