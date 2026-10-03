import moment from 'moment-timezone';
import { describe, expect, it } from 'vitest';
import { DEMO_TIME_ZONE, createSampleNights, createSleepStages, createVitalsSamples, mulberry32 } from './sampleNights';
import { getDeviceStatus, getSettings, getSleepScore, isPrimingAt, listSleepRecords, listVitalsRecords, setSleepRecords } from './mockData';

const ZONES = ['America/Los_Angeles', 'America/New_York', 'Europe/London', 'Asia/Tokyo'];
// Many viewing moments, across a daylight saving change, so the checks do not hang on one date.
const NOWS = Array.from({ length: 140 }, (_, index) => new Date(Date.UTC(2026, 2, 1, 3 + (index * 7) % 24) + index * 24 * 3_600_000));

const minuteOfDay = (date: Date, zone: string) => {
  const local = moment.tz(date, zone);
  return local.hours() * 60 + local.minutes();
};

describe('sample nights', () => {
  it('are built in the demo zone by default, whatever zone the browser is in', () => {
    for (const now of NOWS) {
      for (const night of createSampleNights(now)) {
        expect(minuteOfDay(night.start, DEMO_TIME_ZONE)).toBeGreaterThanOrEqual(21 * 60 + 30);
        expect(minuteOfDay(night.end, DEMO_TIME_ZONE)).toBeLessThanOrEqual(8 * 60 + 30);
      }
    }
  });

  it('report the demo zone in the demo settings', () => {
    expect(getSettings().timeZone).toBe(DEMO_TIME_ZONE);
  });

  it('start between 9:30 PM and midnight and end between 5:30 AM and 8:30 AM in the zone they are built for', () => {
    for (const zone of ZONES) {
      for (const now of NOWS) {
        for (const night of createSampleNights(now, zone)) {
          expect(minuteOfDay(night.start, zone)).toBeGreaterThanOrEqual(21 * 60 + 30);
          expect(minuteOfDay(night.start, zone)).toBeLessThan(24 * 60);
          expect(minuteOfDay(night.end, zone)).toBeGreaterThanOrEqual(5 * 60 + 30);
          expect(minuteOfDay(night.end, zone)).toBeLessThanOrEqual(8 * 60 + 30);
          const hours = (night.end.getTime() - night.start.getTime()) / 3_600_000;
          expect(hours).toBeGreaterThanOrEqual(6 + 40 / 60);
          expect(hours).toBeLessThanOrEqual(8 + 20 / 60);
          expect(night.end.getTime()).toBeLessThanOrEqual(now.getTime());
        }
      }
    }
  });

  it('never start at the same minute', () => {
    for (const now of NOWS) {
      const starts = createSampleNights(now, 'America/Los_Angeles').map(night => Math.floor(night.start.getTime() / 60_000));
      expect(new Set(starts).size).toBe(starts.length);
    }
  });

  it('are the same on every load, and different from day to day', () => {
    const now = new Date('2026-09-28T19:00:00Z');
    expect(createSampleNights(now, 'America/Los_Angeles')).toEqual(createSampleNights(now, 'America/Los_Angeles'));
    const next = createSampleNights(new Date('2026-09-29T19:00:00Z'), 'America/Los_Angeles');
    expect(next[5].start.getTime()).not.toBe(createSampleNights(now, 'America/Los_Angeles')[5].start.getTime() + 24 * 3_600_000);
  });

  it('keep exits inside the night and out of each other', () => {
    for (const now of NOWS) {
      for (const night of createSampleNights(now, 'America/Los_Angeles')) {
        let previous = night.start.getTime();
        for (const [from, to] of night.exits) {
          expect(from.getTime()).toBeGreaterThan(previous);
          expect(to.getTime()).toBeGreaterThan(from.getTime());
          previous = to.getTime();
        }
        expect(previous).toBeLessThan(night.end.getTime());
      }
    }
  });
});

describe('sample hypnogram', () => {
  const epochSignature = (startTime: string, endTime: string) => {
    const { epochs } = createSleepStages(startTime, endTime);
    const minutes: string[] = [];
    for (const epoch of epochs) {
      for (let at = epoch.startUnix; at < epoch.endUnix; at += 60) minutes.push(epoch.stage);
    }
    return minutes;
  };

  it('has only awake and asleep, covering the night without gaps', () => {
    for (const night of createSampleNights(new Date('2026-09-28T19:00:00Z'), 'America/Los_Angeles')) {
      const stages = createSleepStages(night.start.toISOString(), night.end.toISOString());
      expect(stages.epochs.every(epoch => epoch.stage === 'awake' || epoch.stage === 'light')).toBe(true);
      expect(stages.totals.deep + stages.totals.rem).toBe(0);
      expect(stages.epochs[0].startUnix).toBe(night.start.getTime() / 1000);
      expect(stages.epochs[stages.epochs.length - 1].endUnix).toBe(night.end.getTime() / 1000);
      stages.epochs.slice(1).forEach((epoch, index) => expect(epoch.startUnix).toBe(stages.epochs[index].endUnix));
    }
  });

  it('does not repeat with a fixed period or a fixed bout length', () => {
    for (const now of NOWS.slice(0, 30)) {
      for (const night of createSampleNights(now, 'America/Los_Angeles')) {
        const sequence = epochSignature(night.start.toISOString(), night.end.toISOString());
        for (let period = 10; period <= sequence.length / 2; period += 1) {
          const repeats = sequence.every((stage, index) => index + period >= sequence.length || stage === sequence[index + period]);
          expect(repeats, `period ${period} minutes`).toBe(false);
        }
        const bouts = createSleepStages(night.start.toISOString(), night.end.toISOString()).epochs
          .filter(epoch => epoch.stage === 'awake').map(epoch => epoch.endUnix - epoch.startUnix);
        expect(new Set(bouts).size).toBeGreaterThan(1);
      }
    }
  });
});

describe('sample heart rate', () => {
  it('wanders smoothly around 58 bpm and is not an up-down zig-zag', () => {
    for (const now of NOWS.slice(0, 30)) {
      for (const night of createSampleNights(now, 'America/Los_Angeles')) {
        const rates = createVitalsSamples(night.start.toISOString(), night.end.toISOString()).map(sample => sample.heartRate);
        const steps = rates.slice(1).map((rate, index) => rate - rates[index]);
        const alternating = steps.slice(1).every((step, index) => Math.sign(step) === -Math.sign(steps[index]) && step !== 0);
        expect(alternating).toBe(false);
        expect(Math.max(...steps.map(Math.abs))).toBeLessThanOrEqual(6);
        const mean = rates.reduce((sum, rate) => sum + rate, 0) / rates.length;
        expect(mean).toBeGreaterThan(52);
        expect(mean).toBeLessThan(64);
        expect(new Set(rates).size).toBeGreaterThan(5);
      }
    }
  });
});

describe('the demo data', () => {
  it('has records and vitals for the same nights', () => {
    const records = listSleepRecords();
    expect(records).toHaveLength(6);
    expect(new Set(records.map(record => record.id)).size).toBe(6);
    for (const record of records) {
      expect(record.times_exited_bed).toBe(record.not_present_intervals.length);
      expect(record.present_intervals).toHaveLength(record.times_exited_bed + 1);
    }
    expect(listVitalsRecords().length).toBeGreaterThan(300);
  });

  it('scores the two sides of a night differently', () => {
    for (const now of NOWS) {
      const nights = createSampleNights(now, 'America/Los_Angeles');
      setSleepRecords(nights.map(night => ({
        id: night.id, side: night.side, entered_bed_at: night.start.toISOString(), left_bed_at: night.end.toISOString(),
        sleep_period_seconds: 0, times_exited_bed: night.exits.length, present_intervals: [], not_present_intervals: [],
      })));
      for (let index = 0; index < nights.length; index += 2) {
        const [left, right] = [nights[index], nights[index + 1]].map(
          night => getSleepScore(night.start.toISOString(), night.end.toISOString()).score
        );
        expect(left).not.toBe(right);
      }
    }
  });

  it('words bed exits as trips and keeps the lowest heart rate out of the score', () => {
    const [night] = createSampleNights(NOWS[0], 'America/Los_Angeles');
    setSleepRecords([{
      id: night.id, side: night.side, entered_bed_at: night.start.toISOString(), left_bed_at: night.end.toISOString(),
      sleep_period_seconds: 0, times_exited_bed: 1, present_intervals: [], not_present_intervals: [],
    }]);
    const { components } = getSleepScore(night.start.toISOString(), night.end.toISOString());
    expect(components.continuity?.value).toBe('1 trip out of bed');
    expect(components.restingHr).toMatchObject({ available: false, value: expect.stringMatching(/^\d+ bpm$/) });
  });

  it('is not priming while a side is warming', () => {
    const status = getDeviceStatus();
    expect(status.isPriming).toBe(false);
    const warming = [status.left, status.right].some(side => side.isOn && side.currentTemperatureF < side.targetTemperatureF);
    expect(warming).toBe(true);
    expect(isPrimingAt(new Date('2026-09-28T21:35:00Z'))).toBe(false);
  });

  it('primes only just after the daily prime time with both sides off', () => {
    const off = { ...getDeviceStatus(), left: { ...getDeviceStatus().left, isOn: false }, right: { ...getDeviceStatus().right, isOn: false } };
    // 14:30 in Los Angeles.
    expect(isPrimingAt(new Date('2026-09-28T21:35:00Z'), off)).toBe(true);
    expect(isPrimingAt(new Date('2026-09-28T21:45:00Z'), off)).toBe(false);
    expect(isPrimingAt(new Date('2026-09-28T21:25:00Z'), off)).toBe(false);
    expect(isPrimingAt(new Date('2026-09-29T05:00:00Z'), off)).toBe(false);
  });

  it('keeps the prime window at the clock time on a daylight saving change day', () => {
    const off = { ...getDeviceStatus(), left: { ...getDeviceStatus().left, isOn: false }, right: { ...getDeviceStatus().right, isOn: false } };
    // 2026-11-01 is the fall-back day in Los Angeles: 14:30 is 22:30Z, not 21:30Z.
    expect(isPrimingAt(new Date('2026-11-01T22:35:00Z'), off)).toBe(true);
    expect(isPrimingAt(new Date('2026-11-01T21:35:00Z'), off)).toBe(false);
  });

  it('draws the same numbers from the same seed', () => {
    const [a, b] = [mulberry32(7), mulberry32(7)];
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});
