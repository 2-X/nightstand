import memoryDB from '../db/memoryDB.js';
import type { Side } from '../db/schedulesSchema.js';
import { activeAlarms, forgetActiveAlarm } from '../jobs/activeAlarms.js';
import type { ActiveAlarm } from '../jobs/activeAlarms.js';
import logger from '../logger.js';

type DismissTimes = Partial<Record<Side, number>>;

export function parseAlarmDismiss(raw: string | undefined): DismissTimes {
  const times: DismissTimes = {};
  if (!raw) return times;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return times;
    for (const [channel, side] of [['l', 'left'], ['r', 'right']] as const) {
      const timestamp = (value as Record<string, unknown>)[channel];
      if (typeof timestamp === 'number' && Number.isSafeInteger(timestamp) && timestamp >= 0) {
        times[side] = timestamp;
      }
    }
  } catch {
    return times;
  }
  return times;
}

type DismissObservation = {
  alarm: ActiveAlarm | undefined;
  baseline: number;
};

// High-water marks follow alarm generations across connections.
const highestByAlarm = new WeakMap<ActiveAlarm, number>();

export class FirmwareAlarmDismiss {
  private observations = new Map<Side, DismissObservation>();
  private connectionGeneration = 0;

  public reset(): void {
    this.connectionGeneration += 1;
    this.observations.clear();
  }

  public async observe(raw: string | undefined): Promise<void> {
    const connectionGeneration = this.connectionGeneration;
    const times = parseAlarmDismiss(raw);
    const dismissals: Array<[Side, ActiveAlarm]> = [];
    for (const side of ['left', 'right'] as const) {
      const current = times[side];
      if (current === undefined) continue;
      const alarm = activeAlarms.get(side);
      const previous = this.observations.get(side);
      this.observations.set(side, { alarm, baseline: current });
      if (!alarm) continue;
      const highest = highestByAlarm.get(alarm) ?? current;
      highestByAlarm.set(alarm, Math.max(current, highest));
      if (previous?.alarm !== alarm) continue;
      if (current <= previous.baseline || current <= highest) continue;
      dismissals.push([side, alarm]);
    }
    if (dismissals.length === 0) return;
    await memoryDB.read();
    if (connectionGeneration !== this.connectionGeneration) return;
    const dismissed: Side[] = [];
    for (const [side, alarm] of dismissals) {
      if (activeAlarms.get(side) !== alarm) continue;
      forgetActiveAlarm(side);
      memoryDB.data[side].isAlarmVibrating = false;
      dismissed.push(side);
    }
    if (dismissed.length === 0) return;
    await memoryDB.write();
    for (const side of dismissed) {
      logger.info(`Firmware dismissed the alarm on the ${side} side`);
    }
  }
}
