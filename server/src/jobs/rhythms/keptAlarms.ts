import schedule from 'node-schedule';
import type { Side } from '../../db/schedulesSchema.js';
import type { ResolvedSleep, RhythmEvent } from './resolve.js';

export type KeptAlarm = { name: string; event: Extract<RhythmEvent, { kind: 'alarm' }> };
export type KeptSleep = { sleep: ResolvedSleep; alarms: KeptAlarm[] };

// Memory only: a sleep left running when Rhythms is turned off, and the alarms
// still ahead. Nothing is written to a watched file, so a restart drops them.
const kept = new Map<Side, { entry: KeptSleep; generation: number }>();
let generation = 0;

export function rememberKeptAlarms(side: Side, entry: KeptSleep): void {
  if (entry.alarms.length > 0) kept.set(side, { entry, generation: ++generation });
}

export const keptSleeps = (): Array<[Side, KeptSleep]> => [...kept.entries()].map(([side, { entry }]) => [side, entry]);

// Marks the entries a rebuild has seen before it reads the settings.
export const keptAlarmsGeneration = (): number => generation;

export function forgetKeptAlarms(side?: Side): void {
  for (const [key, { entry }] of [...kept.entries()]) {
    if (side !== undefined && key !== side) continue;
    entry.alarms.forEach(alarm => schedule.cancelJob(alarm.name));
    kept.delete(key);
  }
}

// For a rebuild that already cancelled every job. An entry remembered after
// upTo comes from a turn off that rebuild did not see, so it stays.
export function dropKeptAlarms(upTo = Infinity): void {
  for (const [key, entry] of [...kept.entries()]) {
    if (entry.generation <= upTo) kept.delete(key);
  }
}
