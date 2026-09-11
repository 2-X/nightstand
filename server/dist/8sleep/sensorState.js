import { z } from 'zod';
export const sensorKinds = ['frzTemp', 'frzHealth', 'frzTherm', 'bedTemp', 'sensHealth', 'blanketReadings', 'capSense'];
export const SensorSampleSchema = z.object({
    kind: z.enum(sensorKinds), at: z.number().finite(),
    fields: z.record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_.]{0,63}$/), z.union([z.number().finite().min(-100000).max(100000), z.boolean(), z.null()])),
}).strict().refine(sample => Object.keys(sample.fields).length <= 40);
export const sensorMaxAge = (kind) => kind === 'sensHealth' ? 90 : 30;
export class SensorState {
    latest = new Map();
    accept(sample, now = Date.now() / 1000) {
        const previous = this.latest.get(sample.kind);
        if (sample.at > now || now - sample.at > sensorMaxAge(sample.kind) || (previous && sample.at <= previous.at))
            return false;
        this.latest.set(sample.kind, sample);
        return true;
    }
    snapshot(now = Date.now() / 1000) {
        return sensorKinds.map(kind => {
            const sample = this.latest.get(kind);
            const age = sample ? now - sample.at : null;
            const state = age === null ? 'missing' : age < 0 || age > sensorMaxAge(kind) ? 'stale' : 'live';
            return { kind, at: sample?.at ?? null, age, state, fields: sample?.fields ?? {} };
        });
    }
    ready(side, now = Date.now() / 1000) {
        const current = (kind) => {
            const row = this.latest.get(kind);
            return row && row.at <= now && now - row.at <= sensorMaxAge(kind) ? row.fields : null;
        };
        const cover = current('sensHealth');
        const thermal = current('frzTherm');
        const bed = current('bedTemp');
        return cover?.[`${side}.connected`] === true && thermal?.[`${side}.valid`] === true &&
            thermal?.[`${side}.enabled`] === true && ['side', 'out', 'cen', 'in'].every(channel => {
            const value = bed?.[`${side}.${channel}C`];
            return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 50;
        });
    }
}
export const sensorState = new SensorState();
//# sourceMappingURL=sensorState.js.map