import schedule from 'node-schedule';
// Memory only: a sleep left running when Rhythms is turned off, and the alarms
// still ahead. Nothing is written to a watched file, so a restart drops them.
const kept = new Map();
let generation = 0;
export function rememberKeptAlarms(side, entry) {
    if (entry.alarms.length > 0)
        kept.set(side, { entry, generation: ++generation });
}
export const keptSleeps = () => [...kept.entries()].map(([side, { entry }]) => [side, entry]);
// Marks the entries a rebuild has seen before it reads the settings.
export const keptAlarmsGeneration = () => generation;
export function forgetKeptAlarms(side) {
    for (const [key, { entry }] of [...kept.entries()]) {
        if (side !== undefined && key !== side)
            continue;
        entry.alarms.forEach(alarm => schedule.cancelJob(alarm.name));
        kept.delete(key);
    }
}
// For a rebuild that already cancelled every job. An entry remembered after
// upTo comes from a turn off that rebuild did not see, so it stays.
export function dropKeptAlarms(upTo = Infinity) {
    for (const [key, entry] of [...kept.entries()]) {
        if (entry.generation <= upTo)
            kept.delete(key);
    }
}
//# sourceMappingURL=keptAlarms.js.map