import type { Side } from '../db/schedulesSchema.js';

export const activeAlarms = new Map<Side, symbol>();

export function forgetActiveAlarm(side: Side): void {
  activeAlarms.delete(side);
}
