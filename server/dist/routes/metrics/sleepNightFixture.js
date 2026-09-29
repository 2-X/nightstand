export const NIGHT_START = Date.UTC(2026, 8, 28, 6, 30) / 1000;
export const BUCKET = 300;
export const NIGHT_BUCKETS = 72;
export const NIGHT_END = NIGHT_START + NIGHT_BUCKETS * BUCKET;
const HEART_RATES = [72, 74, 71, 73, 77, 70, 75, 76];
const TAIL_HEART_RATES = { 60: 77, 61: 72, 62: 77, 63: 72, 64: 71, 65: 73, 66: 72, 67: 74, 71: 72 };
// Shaped like a night with flapping presence: 23 of 72 buckets have no
// vitals row, heart rate sits between 70 and 77, most HRV and breathing
// estimates are 0, and the only three consecutive calm buckets with vitals
// start at bucket 63.
export function flappingNight() {
    const vitals = [];
    const movements = [];
    let heartIndex = 0;
    for (let bucket = 0; bucket < NIGHT_BUCKETS; bucket++) {
        const timestamp = NIGHT_START + bucket * BUCKET + 60;
        movements.push({ timestamp, total_movement: bucket === 30 ? 400 : 10 + bucket % 5 });
        const missing = (bucket < 60 && bucket % 3 === 2) || (bucket >= 68 && bucket <= 70);
        if (missing)
            continue;
        const heartRate = TAIL_HEART_RATES[bucket] ?? HEART_RATES[heartIndex++ % HEART_RATES.length];
        const estimated = bucket % 4 === 0;
        vitals.push({ timestamp, heart_rate: heartRate, hrv: estimated ? 40 + bucket % 20 : 0, breathing_rate: estimated ? 14 : 0 });
    }
    return { vitals, movements };
}
//# sourceMappingURL=sleepNightFixture.js.map