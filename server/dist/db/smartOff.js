// Shared by server and app: no imports.
const MINUTE = 60_000;
export const SMART_OFF = {
    // Unbroken time out of bed that counts as up.
    outOfBedMinutes: 10,
    // Longest a sleep stays on past its set off.
    extendMinutes: 180,
    // Kept clear before the next sleep's power-on and the daily restart.
    clearMinutes: 30,
};
// The latest a "When I get up" sleep turns off: 3 hours after its set off,
// 30 minutes clear of the next sleep and the daily restart, and never before
// the set off itself.
export function latestOff(input) {
    const setOff = input.setOff.getTime();
    const limits = [setOff + SMART_OFF.extendMinutes * MINUTE];
    for (const wall of [input.nextStart, input.restart]) {
        if (wall)
            limits.push(wall.getTime() - SMART_OFF.clearMinutes * MINUTE);
    }
    return new Date(Math.max(setOff, Math.min(...limits)));
}
export const canStayOn = (setOff, latest) => latest.getTime() > setOff.getTime();
//# sourceMappingURL=smartOff.js.map