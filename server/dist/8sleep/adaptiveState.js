import { existsSync, readFileSync, mkdirSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import config from '../config.js';
const finite = z.number().finite();
const sessionSchema = z.object({ start: finite, end: finite, baselineF: finite, lastAutomaticAt: finite.nullable() });
const sideSchema = z.object({
    mode: z.enum(['off', 'observe', 'active']), minimumF: finite.min(55).max(110), maximumF: finite.min(55).max(110),
    holdUntil: finite, expectedF: finite.nullable().default(null), session: sessionSchema.nullable(), ready: z.boolean(),
});
const eventSchema = z.object({
    id: z.string(), side: z.enum(['left', 'right']), source: z.enum(['physical-button', 'app', 'automatic', 'schedule', 'unknown']),
    at: finite, nightStart: finite, fromF: finite, toF: finite, confirmed: z.boolean(),
});
const stateSchema = z.object({ version: z.literal(1), left: sideSchema, right: sideSchema, events: z.array(eventSchema).max(2000) });
const freshSide = () => ({
    mode: 'observe', minimumF: 55, maximumF: 110, holdUntil: 0, expectedF: null, session: null, ready: true,
});
/** Separate private file: adaptive writes cannot recreate schedule jobs. */
export class AdaptiveStore {
    file;
    data = { version: 1, left: freshSide(), right: freshSide(), events: [] };
    fault = null;
    revision = { left: 0, right: 0 };
    constructor(file) {
        this.file = file;
        try {
            if (existsSync(file)) {
                this.data = stateSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
                // Unknown in-flight writes before a crash cannot safely be replayed.
                for (const side of ['left', 'right']) {
                    const session = this.data[side].session;
                    if (session && session.end > Date.now())
                        this.data[side].holdUntil = Math.max(this.data[side].holdUntil, session.end);
                }
            }
        }
        catch {
            this.fault = 'Adaptive state could not be restored; automatic changes disabled.';
        }
    }
    save() {
        if (this.fault)
            return;
        try {
            this.data.events = this.data.events.filter(event => event.at >= Date.now() - 22 * 86400000).slice(-2000);
            stateSchema.parse(this.data);
            mkdirSync(path.dirname(this.file), { recursive: true });
            const temporary = `${this.file}.tmp`;
            const descriptor = openSync(temporary, 'w', 0o600);
            try {
                writeFileSync(descriptor, JSON.stringify(this.data));
                fsyncSync(descriptor);
            }
            finally {
                closeSync(descriptor);
            }
            renameSync(temporary, this.file);
            const directory = openSync(path.dirname(this.file), 'r');
            try {
                fsyncSync(directory);
            }
            finally {
                closeSync(directory);
            }
        }
        catch {
            this.fault = 'Adaptive state could not be saved; automatic changes disabled.';
        }
    }
    intent(side) {
        this.revision[side]++;
        const state = this.data[side];
        state.holdUntil = Math.max(state.holdUntil, state.session?.end ?? Date.now() + 12 * 3600000);
        this.save();
    }
    record(side, source, fromF, toF, confirmed) {
        const session = this.data[side].session;
        if (!session || source === 'system' || this.data[side].mode === 'off')
            return;
        const event = { id: randomUUID(), side, source, at: Date.now(), nightStart: session.start,
            fromF, toF, confirmed };
        this.data.events.push(event);
        this.save();
    }
}
export const adaptiveStore = new AdaptiveStore(path.join(config.dbFolder, 'adaptive-temperature.json'));
//# sourceMappingURL=adaptiveState.js.map