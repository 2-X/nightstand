const lastChanges = new Map();
export function noteManualPowerChange(side, at = new Date()) {
    lastChanges.set(side, at.getTime());
}
export const lastManualPowerChange = (side) => lastChanges.get(side);
//# sourceMappingURL=manualPowerChange.js.map