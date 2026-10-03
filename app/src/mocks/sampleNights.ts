import moment from 'moment-timezone';
import type { SleepStagesResponse, StageEpoch, SleepStage } from '@api/sleepStages.ts';

type Side = 'left' | 'right';

export type SampleNight = {
  id: number;
  side: Side;
  start: Date;
  end: Date;
  exits: [Date, Date][];
};

export type VitalsSample = { timestamp: number; heartRate: number; hrv: number; breathingRate: number };

// The zone the demo's settings report, which the app renders every time in.
export const DEMO_TIME_ZONE = 'America/Los_Angeles';

const MINUTE_MS = 60_000;
const NIGHTS = 3;
// One row a minute, as the Pod writes them.
const SAMPLE_STEP_SECONDS = 60;

export const mulberry32 = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export const hashSeed = (text: string): number => {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const between = (rand: () => number, low: number, high: number) => low + rand() * (high - low);
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

const gaussian = (rand: () => number) => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());

/** Short wake bouts at irregular times, after a few minutes of falling asleep. Only awake or asleep. */
export const createSleepStages = (startTime: string, endTime: string): SleepStagesResponse => {
  const startUnix = Math.floor(new Date(startTime).getTime() / 1000);
  const endUnix = Math.floor(new Date(endTime).getTime() / 1000);
  const rand = mulberry32(hashSeed(`stages|${new Date(startTime).toISOString()}`));
  const epochs: StageEpoch[] = [];
  const push = (stage: SleepStage, seconds: number) => {
    const from = epochs.length > 0 ? epochs[epochs.length - 1].endUnix : startUnix;
    if (from >= endUnix) return;
    epochs.push({ startUnix: from, endUnix: Math.min(endUnix, from + seconds), stage });
  };
  push('awake', Math.round(between(rand, 8, 24)) * 60);
  while ((epochs.length > 0 ? epochs[epochs.length - 1].endUnix : startUnix) < endUnix) {
    const remaining = endUnix - epochs[epochs.length - 1].endUnix;
    const asleep = Math.round(between(rand, 35, 140)) * 60;
    // A short tail is part of the last stretch rather than a wake bout of its own.
    push('light', remaining - asleep < 15 * 60 ? remaining : asleep);
    push('awake', Math.round(between(rand, 2, 11)) * 60);
  }

  const totals: Record<SleepStage, number> = { awake: 0, rem: 0, light: 0, deep: 0 };
  epochs.forEach((epoch) => {
    totals[epoch.stage] += epoch.endUnix - epoch.startUnix;
  });
  const totalSeconds = Math.max(0, endUnix - startUnix);
  const percentages: Record<SleepStage, number> = { awake: 0, rem: 0, light: 0, deep: 0 };
  (Object.keys(totals) as SleepStage[]).forEach((stage) => {
    percentages[stage] = totalSeconds > 0 ? Math.round((totals[stage] / totalSeconds) * 100) : 0;
  });
  return { active: true, epochs, totals, percentages, totalSeconds };
};

/** A slow random walk around 58 bpm, a few bpm per hour, a little higher while awake. */
export const createVitalsSamples = (startTime: string, endTime: string): VitalsSample[] => {
  const startUnix = Math.floor(new Date(startTime).getTime() / 1000);
  const endUnix = Math.floor(new Date(endTime).getTime() / 1000);
  const { epochs } = createSleepStages(startTime, endTime);
  const rand = mulberry32(hashSeed(`vitals|${new Date(startTime).toISOString()}`));
  let heartRate = between(rand, 55, 61);
  let hrv = between(rand, 60, 85);
  let breathing = between(rand, 12.5, 14.5);
  const samples: VitalsSample[] = [];
  for (let timestamp = startUnix; timestamp <= endUnix; timestamp += SAMPLE_STEP_SECONDS) {
    const awake = epochs.some(epoch => epoch.stage === 'awake' && timestamp >= epoch.startUnix && timestamp < epoch.endUnix);
    heartRate = clamp(heartRate + (58 + (awake ? 5 : 0) - heartRate) * 0.008 + gaussian(rand) * 0.4, 46, 80);
    hrv = clamp(hrv + (72 - hrv) * 0.01 + gaussian(rand) * 0.9, 30, 120);
    breathing = clamp(breathing + (13.5 - breathing) * 0.016 + gaussian(rand) * 0.07, 10, 18);
    samples.push({
      timestamp,
      heartRate: Math.round(heartRate),
      hrv: Math.round(hrv),
      breathingRate: Math.round(breathing * 10) / 10,
    });
  }
  return samples;
};


// The same scorers as the server (routes/metrics/sleepScore.ts): 8h asleep is 100, each bed exit costs 15,
// and the lowest heart rate is reported but not scored.
export const nightScore = (start: Date | string, end: Date | string, exits: number) => {
  const startTime = new Date(start).toISOString();
  const endTime = new Date(end).toISOString();
  const { totals } = createSleepStages(startTime, endTime);
  const asleepSeconds = totals.light + totals.rem + totals.deep;
  const minHeartRate = Math.min(...createVitalsSamples(startTime, endTime).map(sample => sample.heartRate));
  const duration = Math.max(0, Math.round(100 - Math.abs(asleepSeconds / 3600 - 8) * 10));
  const continuity = Math.max(0, 100 - exits * 15);
  const score = Math.round((duration * 0.4 + continuity * 0.3) / 0.7);
  return { score, duration, continuity, asleepSeconds, minHeartRate };
};

// Starts around 10:45 PM local and ends in the morning, within 6h 40m to 8h 20m.
const nightWindow = (day: moment.Moment, side: Side, attempt: number): { start: moment.Moment; end: moment.Moment } => {
  const rand = mulberry32(hashSeed(`night|${day.format('YYYY-MM-DD')}|${side}|${attempt}`));
  const start = day.clone().hour(22).minute(45).add(Math.round(between(rand, -40, 40)), 'minutes');
  const morning = day.clone().add(1, 'day');
  const earliest = moment.max(start.clone().add(400, 'minutes'), morning.clone().hour(5).minute(30));
  const latest = moment.min(start.clone().add(500, 'minutes'), morning.clone().hour(8).minute(30));
  const end = earliest.clone().add(Math.round(rand() * latest.diff(earliest, 'minutes')), 'minutes');
  return { start, end };
};

const placeExits = (rand: () => number, start: Date, end: Date, count: number): [Date, Date][] => {
  const from = start.getTime() + 90 * MINUTE_MS;
  const slot = (end.getTime() - 60 * MINUTE_MS - from) / Math.max(count, 1);
  return Array.from({ length: count }, (_, index) => {
    const minutes = Math.round(between(rand, 3, 9));
    const offset = Math.round(between(rand, 0, slot / MINUTE_MS - minutes));
    const exitStart = from + index * slot + offset * MINUTE_MS;
    return [new Date(exitStart), new Date(exitStart + minutes * MINUTE_MS)];
  });
};

const buildNights = (today: moment.Moment, latest: number): SampleNight[] => {
  const taken = new Set<number>();
  const nights: SampleNight[] = [];
  for (let n = NIGHTS - 1; n >= 0; n -= 1) {
    const day = today.clone().subtract(latest + n, 'days');
    const dayKey = day.format('YYYY-MM-DD');
    const [left, right] = (['left', 'right'] as const).map((side, sideIndex) => {
      let attempt = 0;
      let window = nightWindow(day, side, attempt);
      while (taken.has(window.start.unix() / 60)) {
        attempt += 1;
        window = nightWindow(day, side, attempt);
      }
      taken.add(window.start.unix() / 60);
      return { id: n * 2 + sideIndex + 1, side, start: window.start.toDate(), end: window.end.toDate() };
    });
    const exitRand = mulberry32(hashSeed(`exits|${dayKey}`));
    const leftExits = Math.floor(exitRand() * 3);
    // One of the two other counts always separates the scores, since the bands are 15 points apart.
    // Two sleepers rarely leave the bed equally often, so the sides differ in exits and therefore in score.
    const first = 1 + Math.floor(exitRand() * 2);
    const rightExits = [first, 3 - first].map(offset => (leftExits + offset) % 3).find(
      count => nightScore(left.start, left.end, leftExits).score !== nightScore(right.start, right.end, count).score
    ) ?? (leftExits + first) % 3;
    [[left, leftExits], [right, rightExits]].forEach(([night, count]) => {
      const sample = night as Omit<SampleNight, 'exits'>;
      const rand = mulberry32(hashSeed(`absence|${dayKey}|${sample.side}`));
      nights.push({ ...sample, exits: placeExits(rand, sample.start, sample.end, count as number) });
    });
  }
  return nights;
};

/** Three recent nights for both sides, oldest first, in the evenings and mornings of `zone`. */
export const createSampleNights = (now: Date, zone: string = DEMO_TIME_ZONE): SampleNight[] => {
  const today = moment.tz(now, zone).startOf('day');
  // The latest night is the most recent evening whose morning has already come.
  for (let latest = 1; ; latest += 1) {
    const nights = buildNights(today, latest);
    if (nights.every(night => night.end.getTime() <= now.getTime())) return nights;
  }
};
