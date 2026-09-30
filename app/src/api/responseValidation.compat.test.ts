import { expect, it } from 'vitest';
import { validateResponse } from './responseValidation';
import { getDeviceStatus, getSchedules, getServices, getSettings } from '../mocks/mockData';
import { SettingsSchema } from './settingsSchema';
import { DailyScheduleSchema } from './schedulesSchema';

it.each([
  ['/settings', getSettings], ['/schedules', getSchedules], ['/services', getServices], ['/deviceStatus', getDeviceStatus],
] as const)('strips future keys from %s without changing the source', (path, fixture) => {
  const data = structuredClone(fixture());
  const addUnknown = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(addUnknown); return; }
    Object.values(value).forEach(addUnknown);
    // Records have meaningful keys, so only add to objects with named fields.
    if (Object.keys(value).some(key => /^[a-z]/i.test(key))) Object.assign(value, { futureField: true });
  };
  addUnknown(data);
  expect(validateResponse(path, data)).toEqual(fixture());
  expect(data).toHaveProperty('futureField', true);
});

it('accepts upstream status without sensor temperatures', () => {
  const status: Record<string, unknown> = { ...getDeviceStatus() };
  delete status.sensorTemps;
  expect(validateResponse('/deviceStatus', status)).toEqual(status);
});

it('accepts legacy alarm counts and keeps request limits', () => {
  const schedules = structuredClone(getSchedules());
  schedules.left.monday.alarms = Array.from({ length: 12 }, () => ({ ...schedules.left.monday.alarm }));
  expect(validateResponse('/schedules', schedules)).toEqual(schedules);
  expect(DailyScheduleSchema.safeParse(schedules.left.monday).success).toBe(false);
});

it('keeps known-value bounds and strict requests', () => {
  const settings = { ...getSettings(), future: true };
  expect(SettingsSchema.safeParse(settings).success).toBe(false);
  expect(() => validateResponse('/deviceStatus', {
    ...getDeviceStatus(), left: { ...getDeviceStatus().left, targetTemperatureF: 500 },
  })).toThrow();
});

it('accepts fields absent from older settings and services', () => {
  const settings = structuredClone(getSettings()) as unknown as Record<string, unknown>;
  for (const key of ['features', 'rebootDaily', 'rawArchiveRetentionDays', 'updateChannel']) delete settings[key];
  for (const side of ['left', 'right']) {
    delete (settings[side] as Record<string, unknown>).oneOffAlarm;
    delete (settings[side] as Record<string, unknown>).alarmsEnabled;
  }
  expect(() => validateResponse('/settings', settings)).not.toThrow();
  const services = structuredClone(getServices());
  const jobs = services.biometrics.jobs as unknown as Record<string, unknown>;
  for (const key of ['calibrateLeft', 'calibrateRight', 'pumpLeft', 'pumpRight']) delete jobs[key];
  expect(() => validateResponse('/services', services)).not.toThrow();
});

it('strips future compatibility fixtures after defaults are backfilled', async () => {
  const { default: merge } = await import('lodash/merge');
  const settings = await import('../../../fixtures/compat/future/settingsDB.json');
  const schedules = await import('../../../fixtures/compat/future/schedulesDB.json');
  const services = await import('../../../fixtures/compat/future/servicesDB.json');
  for (const [path, defaults, fixture] of [
    ['/settings', getSettings(), settings.default],
    ['/schedules', getSchedules(), schedules.default],
    ['/services', getServices(), services.default],
  ] as const) {
    const input = merge({}, defaults, fixture);
    const result = validateResponse(path, input);
    const text = JSON.stringify(result);
    for (const key of ['futureTop', 'futureSide', 'futureDay', 'strayScalar', 'futureService', 'sentryLogging', 'rhythms', 'pause']) {
      expect(text).not.toContain(`"${key}"`);
    }
    expect(input).toEqual(merge({}, defaults, fixture));
  }
});

// Shapes as the Pod serves them: times formatted in the Pod's timezone.
it('accepts sleep times with a timezone offset', () => {
  const sleep = [{ id: 1, side: 'left', entered_bed_at: '2026-09-28T23:45:30-07:00', left_bed_at: '2026-09-29T05:40:14-07:00',
    sleep_period_seconds: 20684, times_exited_bed: 1,
    present_intervals: [['2026-09-28T23:45:30-07:00', '2026-09-29T05:28:40-07:00']],
    not_present_intervals: [['2026-09-29T05:28:40-07:00', '2026-09-29T05:29:06-07:00']] }];
  expect(validateResponse('/metrics/sleep', sleep)).toEqual(sleep);
});

it('keeps the sleep-stages coverage flag and accepts servers that do not send it', () => {
  const stages = {
    active: true, epochs: [{ startUnix: 0, endUnix: 300, stage: 'light' }],
    totals: { awake: 0, rem: 0, light: 300, deep: 0 }, percentages: { awake: 0, rem: 0, light: 100, deep: 0 }, totalSeconds: 300,
  };
  expect(validateResponse('/metrics/sleep-stages', { ...stages, lowCoverage: true })).toEqual({ ...stages, lowCoverage: true });
  expect(validateResponse('/metrics/sleep-stages', stages)).toEqual(stages);
});

// A newer Pod may record fractional or higher heart rates and leave estimates
// empty; one such row must not fail the whole night after a rollback.
it('accepts vitals rows beyond today\'s recorder limits', () => {
  const vitals = [
    { side: 'left', timestamp: 1790664360, heart_rate: 92.4, hrv: null, breathing_rate: 0, rmssd: 41.2 },
    { side: 'right', timestamp: 1790664420, heart_rate: 64, hrv: 38, breathing_rate: 15 },
  ];
  expect(validateResponse('/metrics/vitals', vitals)).toEqual([
    { side: 'left', timestamp: 1790664360, heart_rate: 92.4, hrv: null, breathing_rate: 0 },
    vitals[1],
  ]);
});
