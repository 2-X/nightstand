import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateResponse } from './responseValidation';
import moment from 'moment-timezone';
import { getDeviceStatus, getSchedules, getSettings } from '../mocks/mockData';

type Loose = Record<string, any>;

afterEach(() => vi.restoreAllMocks());

describe('device status', () => {
  it.each(['waterLevel', 'coverVersion', 'hubVersion', 'wifiStrength'])('keeps the bed usable without %s', key => {
    const status: Loose = structuredClone(getDeviceStatus());
    delete status[key];
    const result = validateResponse('/deviceStatus', status) as Loose;
    expect(result.left.targetTemperatureF).toBe(getDeviceStatus().left.targetTemperatureF);
  });

  it('shows hardware and Wi-Fi rows as absent, not as undefined text', () => {
    const status: Loose = structuredClone(getDeviceStatus());
    delete status.coverVersion;
    status.wifiStrength = 'strong';
    const result = validateResponse('/deviceStatus', status) as Loose;
    expect(result.coverVersion).toBe('Version not found');
    expect(result.wifiStrength).toBe(0);
  });

  it('ignores sensor temperatures it cannot read', () => {
    const status: Loose = structuredClone(getDeviceStatus());
    status.sensorTemps = { ambientC: 20, ambientF: 68, heatsinkC: 30, leftC: 25, rightC: 25, lastUpdated: 1790664360 };
    expect(() => validateResponse('/deviceStatus', status)).not.toThrow();
    status.left.currentTemperatureLevel = 'x';
    status.right.secondsRemaining = null;
    expect(() => validateResponse('/deviceStatus', status)).not.toThrow();
  });

  it.each([
    ['left.currentTemperatureF', (status: Loose) => { delete status.left.currentTemperatureF; }],
    ['left.isOn', (status: Loose) => { status.left.isOn = 'yes'; }],
    ['right.isAlarmVibrating', (status: Loose) => { delete status.right.isAlarmVibrating; }],
    ['settings.ledBrightness', (status: Loose) => { delete status.settings.ledBrightness; }],
    ['isPriming', (status: Loose) => { delete status.isPriming; }],
    ['freeSleep.version', (status: Loose) => { delete status.freeSleep.version; }],
  ])('still rejects a bad %s', (_name, damage) => {
    const status: Loose = structuredClone(getDeviceStatus());
    damage(status);
    expect(() => validateResponse('/deviceStatus', status)).toThrow();
  });
});

describe('settings', () => {
  const settings = (): Loose => structuredClone(getSettings());

  it('keeps any real time zone, keeps an unset zone unset, and reads an unknown one as unset', () => {
    const value = settings();
    value.timeZone = 'Pacific/Kiritimati';
    expect((validateResponse('/settings', value) as Loose).timeZone).toBe('Pacific/Kiritimati');
    value.timeZone = null;
    expect((validateResponse('/settings', value) as Loose).timeZone).toBeNull();
    value.timeZone = 'Not/AZone';
    expect((validateResponse('/settings', value) as Loose).timeZone).toBeNull();
    value.timeZone = 5;
    expect((validateResponse('/settings', value) as Loose).timeZone).toBeNull();
  });

  it('reads override expiries the way the Pod does instead of treating them as absent', () => {
    const value = settings();
    const instant = Date.parse('2026-09-30T14:00:00Z');
    value.left.scheduleOverrides.temperatureSchedules = { disabled: true, expiresAt: instant };
    value.right.scheduleOverrides.alarm = { disabled: false, timeOverride: '7:30', expiresAt: '2026-09-30T07:00:00' };
    const result = validateResponse('/settings', value) as Loose;
    const left = result.left.scheduleOverrides.temperatureSchedules;
    expect(left.disabled).toBe(true);
    expect(Date.parse(String(left.expiresAt))).toBe(instant);
    expect(left.expiresAt).toMatch(/[+-]\d\d:\d\d$|Z$/);
    const right = result.right.scheduleOverrides.alarm;
    expect(right.timeOverride).toBe('07:30');
    expect(Date.parse(String(right.expiresAt))).toBe(moment('2026-09-30T07:00:00').valueOf());
  });

  it('keeps a valid override expiry exactly as sent and an unreadable one present', () => {
    const value = settings();
    value.left.scheduleOverrides.temperatureSchedules = { disabled: true, expiresAt: '2026-09-30T07:00:00-07:00' };
    value.right.scheduleOverrides.temperatureSchedules = { disabled: true, expiresAt: 'soon' };
    value.right.scheduleOverrides.alarm = { disabled: false, timeOverride: '7am', expiresAt: { until: 1 } };
    const result = validateResponse('/settings', value) as Loose;
    expect(result.left.scheduleOverrides.temperatureSchedules.expiresAt).toBe('2026-09-30T07:00:00-07:00');
    expect(result.right.scheduleOverrides.temperatureSchedules.expiresAt).toBe('soon');
    expect(result.right.scheduleOverrides.alarm).toEqual({ disabled: false, timeOverride: '', expiresAt: '' });
  });

  it('normalizes an armed one-time alarm instead of hiding it', () => {
    const value = settings();
    value.left.oneOffAlarm = { ...value.left.oneOffAlarm, enabled: true, fireAt: '2026-09-30 07:00' };
    const result = validateResponse('/settings', value) as Loose;
    expect(result.left.oneOffAlarm.enabled).toBe(true);
    expect(Date.parse(String(result.left.oneOffAlarm.fireAt))).toBe(moment('2026-09-30T07:00:00').valueOf());
    value.left.oneOffAlarm.fireAt = 'tomorrow morning';
    expect((validateResponse('/settings', value) as Loose).left.oneOffAlarm.fireAt).toBe('tomorrow morning');
  });

  it('rejects an armed one-time alarm with an unusable vibration field', () => {
    const value = settings();
    value.left.oneOffAlarm = { ...value.left.oneOffAlarm, enabled: true, vibrationIntensity: 'max' };
    expect(() => validateResponse('/settings', value)).toThrow();
    value.left.oneOffAlarm.enabled = 'yes';
    expect(() => validateResponse('/settings', value)).toThrow();
  });

  it('drops a disabled one-time alarm that cannot be read, since the Pod ignores it', () => {
    const value = settings();
    value.left.oneOffAlarm = { ...value.left.oneOffAlarm, enabled: false, vibrationIntensity: 'max' };
    const result = validateResponse('/settings', value) as Loose;
    expect(result.left.oneOffAlarm).toBeUndefined();
    expect(result.left.name).toBe(getSettings().left.name);
    expect(result.right.oneOffAlarm).toEqual(getSettings().right.oneOffAlarm);
  });

  it('degrades a bad side name, format, channel and single feature on their own', () => {
    const value = settings();
    value.left.name = 42;
    value.temperatureFormat = 'kelvin';
    value.updateChannel = 'nightly';
    value.rebootDaily = 'sometimes';
    value.features.sleepScore = 'yes';
    value.features.levelTemps = 0;
    value.left.alarmsEnabled = 'no';
    value.right.alarmsEnabled = null;
    const result = validateResponse('/settings', value) as Loose;
    expect(result.left.name).toBe('');
    expect(result.temperatureFormat).toBe('fahrenheit');
    expect(result.updateChannel).toBeUndefined();
    expect(result.rebootDaily).toBeUndefined();
    expect(result.features.sleepScore).toBe(true);
    expect(result.features.levelTemps).toBe(false);
    expect(result.left.alarmsEnabled).toBe(true);
    expect(result.right.alarmsEnabled).toBe(false);
    expect(result.features.oneOffAlarms).toBe(getSettings().features.oneOffAlarms);
  });

  it.each([
    ['awayMode', (value: Loose) => { value.left.awayMode = 'no'; }],
    ['scheduleOverrides.disabled', (value: Loose) => { value.left.scheduleOverrides.alarm.disabled = 1; }],
    ['primePodDaily.time', (value: Loose) => { value.primePodDaily.time = '25:00'; }],
    ['primePodDaily missing', (value: Loose) => { delete value.primePodDaily; }],
  ])('still rejects a bad %s', (_name, damage) => {
    const value = settings();
    damage(value);
    expect(() => validateResponse('/settings', value)).toThrow();
  });
});

describe('schedules', () => {
  const schedules = (): Loose => structuredClone(getSchedules());

  it('normalizes steps the Pod still runs and drops only unusable ones', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const value = schedules();
    value.left.monday.temperatures = { '22:00': 70, '5:30': 68.4, '23:00': 500, '25:99': 70, '01:00': '68', '05:00': null, '06:00': 74 };
    const result = validateResponse('/schedules', value) as Loose;
    expect(result.left.monday.temperatures).toEqual({ '22:00': 70, '05:30': 68, '23:00': 500, '06:00': 74 });
    expect(result.left.tuesday).toEqual(getSchedules().left.tuesday);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('prefers an already padded key when a short one collides with it', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const value = schedules();
    value.left.monday.temperatures = { '7:00': 70, '07:00': 72 };
    expect((validateResponse('/schedules', value) as Loose).left.monday.temperatures).toEqual({ '07:00': 72 });
  });

  it('does not warn when every step is valid', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    validateResponse('/schedules', schedules());
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    ['power.onTemperature', (value: Loose) => { value.left.monday.power.onTemperature = 300; }],
    ['power.on', (value: Loose) => { value.left.monday.power.on = 'late'; }],
    ['alarm.time', (value: Loose) => { value.right.friday.alarm.time = '7am'; }],
    ['temperatures not a map', (value: Loose) => { value.left.monday.temperatures = []; }],
  ])('still rejects a bad %s', (_name, damage) => {
    const value = schedules();
    damage(value);
    expect(() => validateResponse('/schedules', value)).toThrow();
  });
});
