import logger from '../logger.js';
// Readings arrive every 2s, so a change must hold for about 30s before it
// counts. Water moving in the tank while the pump primes should not log a
// refill and a new low a few seconds apart.
export const CONFIRM_READINGS = 15;
function parseLevel(raw) {
    if (raw === 'true')
        return 'ok';
    if (raw === 'false')
        return 'low';
    return undefined;
}
// Stores only the transitions between ok and low, so the table stays a few
// rows long and "low since" survives a restart.
export class WaterLevelTracker {
    store;
    onChange;
    state;
    candidate;
    candidateCount = 0;
    constructor(store, onChange) {
        this.store = store;
        this.onChange = onChange;
    }
    async init() {
        try {
            const latest = await this.store.latest();
            if (latest)
                this.state = { level: latest.level, since: latest.timestamp };
        }
        catch (error) {
            logger.warn(`Water level history unavailable: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    observe(raw, now = Math.floor(Date.now() / 1000)) {
        const level = parseLevel(raw);
        if (!level)
            return;
        if (level === this.state?.level) {
            this.candidate = undefined;
            this.candidateCount = 0;
            return;
        }
        let confirmed = this.candidate;
        if (level !== confirmed?.level) {
            confirmed = { level, since: now };
            this.candidateCount = 0;
        }
        this.candidate = confirmed;
        this.candidateCount++;
        if (this.candidateCount < CONFIRM_READINGS)
            return;
        this.state = confirmed;
        this.candidate = undefined;
        this.candidateCount = 0;
        this.onChange(confirmed);
        this.store.append({ level: confirmed.level, timestamp: confirmed.since }).catch((error) => {
            logger.warn(`Failed to record water level: ${error instanceof Error ? error.message : String(error)}`);
        });
    }
}
//# sourceMappingURL=waterLevelTracker.js.map