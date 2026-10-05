import type { Side } from '../db/schedulesSchema.js';

const lastChanges = new Map<Side, number>();

export function noteManualPowerChange(side: Side, at = new Date()): void {
  lastChanges.set(side, at.getTime());
}

export const lastManualPowerChange = (side: Side): number | undefined => lastChanges.get(side);
