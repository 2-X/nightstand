import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateResponse } from './responseValidation';
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

  it('accepts any real time zone and falls back to UTC for an unknown one', () => {
    const value = settings();
    value.timeZone = 'Pacific/Kiritimati';
    expect((validateResponse('/settings', value) as Loose).timeZone).toBe('Pacific/Kiritimati');
    value.timeZone = 'Not/AZone';
    expect((validateResponse('/settings', value) as Loose).timeZone).toBe('UTC');
    value.timeZone = 5;
    expect((validateResponse('/settings', value) as Loose).timeZone).toBe('UTC');
  });

  it('treats an unreadable override expiry as no override', () => {
    const value = settings();
    value.left.scheduleOverrides.temperatureSchedules = { disabled: true, expiresAt: 1790664360 };
    value.right.scheduleOverrides.alarm = { disabled: false, timeOverride: '25:99', expiresAt: 'soon' };
    const result = validateResponse('/settings', value) as Loose;
    expect(result.left.scheduleOverrides.temperatureSchedules).toEqual({ disabled: true, expiresAt: '' });
    expect(result.right.scheduleOverrides.alarm).toEqual({ disabled: false, timeOverride: '', expiresAt: '' });
  });

  it('drops a one-time alarm with an unreadable field and keeps the side', () => {
    const value = settings();
    value.left.oneOffAlarm.fireAt = 'tomorrow morning';
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
    const result = validateResponse('/settings', value) as Loose;
    expect(result.left.name).toBe('');
    expect(result.temperatureFormat).toBe('fahrenheit');
    expect(result.updateChannel).toBeUndefined();
    expect(result.rebootDaily).toBeUndefined();
    expect(result.features.sleepScore).toBeUndefined();
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

  it('drops one bad temperature step and keeps every day usable', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const value = schedules();
    value.left.monday.temperatures = { '22:00': 70, '23:00': 500, '25:99': 70, '01:00': '68', '05:00': 74 };
    const result = validateResponse('/schedules', value) as Loose;
    expect(result.left.monday.temperatures).toEqual({ '22:00': 70, '05:00': 74 });
    expect(result.left.tuesday).toEqual(getSchedules().left.tuesday);
    expect(warn).toHaveBeenCalledTimes(1);
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
