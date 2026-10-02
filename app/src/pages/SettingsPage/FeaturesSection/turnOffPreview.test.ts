import { expect, it } from 'vitest';
import moment from 'moment-timezone';
import type { ResolvedSleepResponse, SleepEvent } from '@api/rhythmsResponse';
import { getSchedules, getSettings } from '../../../mocks/mockData';
import { alarmLine, handoffFailed, handoffSummary, keepOnLabel, previewLines, runningSides, turnOffPreview } from './turnOffPreview';

const settings = () => {
  const value = structuredClone(getSettings());
  value.timeZone = 'UTC';
  return value;
};
const alarm = { time: '15:15', enabled: true, vibrationIntensity: 30, vibrationPattern: 'rise' as const, duration: 30, alarmTemperature: 83 };
const sleep = (start: string, end: string, alarmAt?: string): ResolvedSleepResponse => ({
  side: 'right', date: start.slice(0, 10), rhythmId: 'night-shift', start, end, mode: 'manual',
  night: { power: { on: '08:00', off: '15:30', onTemperature: 83, enabled: true }, temperatures: {}, alarm, alarms: [alarm] },
  events: [
    { kind: 'power-on', at: start, temperatureF: 83 },
    ...(alarmAt ? [{ kind: 'alarm', at: alarmAt, alarm, index: 0 } as SleepEvent] : []),
    { kind: 'power-off', at: end },
  ],
});
const preview = (now: string, right: ResolvedSleepResponse[]) =>
  turnOffPreview({ settings: settings(), schedules: getSchedules(), sleeps: { left: [], right }, now: new Date(now) });

it('finds a rhythm sleep the weekly schedule does not cover', () => {
  const [left, right] = preview('2026-09-29T10:00:00Z', [sleep('2026-09-29T08:00:00.000Z', '2026-09-29T15:30:00.000Z')]);
  expect(left.inSleepUntil).toBeUndefined();
  expect(right.inSleepUntil?.toISOString()).toBe('2026-09-29T15:30:00.000Z');
  expect(right.weeklyCoversNow).toBe(false);
  expect(right.nextOn?.at.format('ddd HH:mm')).toBe('Tue 21:15');
  expect(right.nextOff?.format('ddd HH:mm')).toBe('Wed 06:30');
});

it('lets the weekly schedule take over when it already covers now', () => {
  const [, right] = preview('2026-09-29T02:00:00Z', [sleep('2026-09-28T23:00:00.000Z', '2026-09-29T07:00:00.000Z')]);
  expect(right.weeklyCoversNow).toBe(true);
  expect(previewLines(right, moment.utc('2026-09-29T02:00:00Z'))[0]).toBe('Now: weekly schedule until 8:30 AM.');
});

it('says when a later rhythm alarm matches the weekly one', () => {
  const [, right] = preview('2026-09-29T10:00:00Z', [
    sleep('2026-09-29T08:00:00.000Z', '2026-09-29T15:30:00.000Z', '2026-09-29T15:15:00.000Z'),
    sleep('2026-09-29T21:15:00.000Z', '2026-09-30T06:30:00.000Z', '2026-09-30T06:30:00.000Z'),
  ]);
  expect(alarmLine(right)).toBe('Alarm: Tue 3:15 PM still rings. After that, the weekly alarm at Wed 6:30 AM, as now.');
});

it('writes the preview and the result in plain words', () => {
  const [, right] = preview('2026-09-29T10:00:00Z', [
    sleep('2026-09-29T08:00:00.000Z', '2026-09-29T15:30:00.000Z', '2026-09-29T15:15:00.000Z'),
  ]);
  const now = moment.utc('2026-09-29T10:00:00Z');
  expect(previewLines(right, now)).toEqual([
    "Stays on at its current temperature until 3:30 PM, and its alarm still rings. The rest of this sleep's plan stops.",
    'Tonight: weekly schedule, 9:15 PM to 6:30 AM.',
    'Alarm: Tue 3:15 PM still rings. After that, the weekly alarm at Wed 6:30 AM.',
  ]);
  // Turning the side off now drops the kept alarm from the line.
  expect(alarmLine(right, false)).toBe('Alarm: the weekly alarm at Wed 6:30 AM rings instead of Tue 3:15 PM.');
  expect(keepOnLabel(right)).toBe("Keep Sam's side on until 3:30 PM (its 3:15 PM alarm still rings)");
  expect(handoffSummary({ sides: [
    { side: 'left', action: 'legacy-takes-over' },
    { side: 'right', action: 'kept-on-until', until: '2026-09-29T15:30:00.000Z' },
  ] }, settings())).toBe('Rhythms is off. Alex: the weekly schedule takes over. Sam: stays on until 3:30 PM.');
  expect(handoffSummary({ sides: [{ side: 'left', action: 'none' }, { side: 'right', action: 'legacy-takes-over' }] }, settings()))
    .toBe('Rhythms is off. The weekly schedule is back for both sides.');
});

it('says which side the Pod could not change', () => {
  const report = { sides: [
    { side: 'left' as const, action: 'powered-off', deviceUpdateFailed: true },
    { side: 'right' as const, action: 'legacy-takes-over', deviceUpdateFailed: true },
  ] };
  expect(handoffSummary(report, settings())).toBe('Rhythms is off. Could not reach the Pod, so Alex was not changed. '
    + 'Sam: the weekly schedule takes over. Could not reach the Pod, so Sam was not changed.');
  expect(handoffFailed(report)).toBe(true);
  expect(handoffFailed({ sides: [{ side: 'left', action: 'powered-off' }] })).toBe(false);
});

it('lets the weekly night that starts by the bedtime take over a Smart Schedule pre-warm', () => {
  const schedules = structuredClone(getSchedules());
  const monday = schedules.right.monday;
  const weekly = { ...monday, power: { ...monday.power, enabled: true, on: '22:00', off: '06:30' } };
  schedules.right = { ...schedules.right, monday: weekly };
  const smart = { ...sleep('2026-09-28T21:30:00.000Z', '2026-09-29T06:30:00.000Z', '2026-09-29T06:00:00.000Z'), mode: 'smart' as const };
  smart.smartCurve = { bedtime: '2026-09-28T22:00:00.000Z', coolStart: '2026-09-28T22:00:00.000Z', wake: '2026-09-29T06:00:00.000Z',
    daySleep: false, points: [] };
  const now = new Date('2026-09-28T21:45:00Z');
  const [, right] = turnOffPreview({ settings: settings(), schedules, sleeps: { left: [], right: [smart] }, now });
  expect(right.weeklyCoversNow).toBe(true);
  expect(runningSides([right])).toEqual([]);
  expect(alarmLine(right)).not.toMatch(/still rings/);
});

// Monday's weekly night runs 9:00 PM to 8:30 AM with a 7:00 AM alarm, and Tuesday's has the same alarm.
const sevenAmAlarms = () => {
  const schedules = structuredClone(getSchedules());
  const { monday, tuesday } = schedules.right;
  const at7 = { ...monday.alarm, time: '07:00' };
  schedules.right = {
    ...schedules.right,
    monday: { ...monday, alarm: at7, alarms: [at7] },
    tuesday: { ...tuesday, power: { ...tuesday.power, off: '07:30' }, alarm: at7, alarms: [at7] },
  };
  return schedules;
};
const rangSleep = () => sleep('2026-09-28T22:00:00.000Z', '2026-09-29T07:15:00.000Z', '2026-09-29T06:00:00.000Z');

it('says the weekly alarm is skipped once this sleep\'s alarm rang', () => {
  const now = new Date('2026-09-29T06:30:00Z');
  const [, right] = turnOffPreview({ settings: settings(), schedules: sevenAmAlarms(), sleeps: { left: [], right: [rangSleep()] }, now });
  expect(right.weeklyCoversNow).toBe(true);
  expect(previewLines(right, moment.utc(now))).toEqual([
    'Now: weekly schedule until 8:30 AM.',
    'Tonight: weekly schedule, 9:15 PM to 7:30 AM.',
    "The weekly alarm at Tue 7:00 AM is skipped, since this sleep's alarm already rang. Next alarm: the weekly alarm at Wed 7:00 AM.",
  ]);
  // Turned off now, the side rings nothing until its next weekly start, and the Pod sets no skip.
  expect(previewLines(right, moment.utc(now), false)).toEqual([
    'Tonight: weekly schedule, 9:15 PM to 7:30 AM.',
    'Alarm: the weekly alarm at Wed 7:00 AM.',
  ]);
});

it('skips nothing when an alarm override is already set', () => {
  const value = settings();
  value.right.scheduleOverrides.alarm = { disabled: true, timeOverride: '', expiresAt: '2026-09-29T08:30:00.000Z' };
  const now = new Date('2026-09-29T06:30:00Z');
  const [, right] = turnOffPreview({ settings: value, schedules: sevenAmAlarms(), sleeps: { left: [], right: [rangSleep()] }, now });
  expect(right.skippedWeeklyAlarms).toEqual([]);
  expect(alarmLine(right)).toBe('Alarm: the weekly alarm at Wed 7:00 AM.');
});

it('keeps nothing running for a side that is off', () => {
  const now = new Date('2026-09-29T06:30:00Z');
  const [, right] = turnOffPreview({
    settings: settings(), schedules: sevenAmAlarms(), sleeps: { left: [], right: [rangSleep()] }, now, isOn: { right: false },
  });
  expect(right.inSleepUntil).toBeUndefined();
  expect(right.skippedWeeklyAlarms).toEqual([]);
  expect(previewLines(right, moment.utc(now))).toEqual([
    'Tonight: weekly schedule, 9:15 PM to 7:30 AM.',
    'Alarm: the weekly alarm at Wed 7:00 AM.',
  ]);
});

it('has an away side follow the present side, without alarms', () => {
  const value = settings();
  value.left.awayMode = true;
  const now = new Date('2026-09-29T10:00:00Z');
  // The Pod answers an away side with the present side's sleeps, without alarms.
  const shared = { ...sleep('2026-09-29T08:00:00.000Z', '2026-09-29T15:30:00.000Z'), side: 'right' as const };
  const [left] = turnOffPreview({ settings: value, schedules: getSchedules(), sleeps: { left: [shared], right: [shared] }, now });
  expect(left.follows).toBe('Sam');
  expect(left.inSleepUntil?.toISOString()).toBe('2026-09-29T15:30:00.000Z');
  expect(previewLines(left, moment.utc(now))).toEqual([
    "Away mode is on, so this side follows Sam's schedule.",
    "Stays on at its current temperature until 3:30 PM. The rest of this sleep's plan stops.",
    'Tonight: weekly schedule, 9:15 PM to 6:30 AM.',
    'No alarm in the next 2 days.',
  ]);
  expect(keepOnLabel(left)).toBe("Keep Alex's side on until 3:30 PM");

  // With both sides away the Pod runs nothing.
  value.right.awayMode = true;
  const [, right] = turnOffPreview({ settings: value, schedules: getSchedules(), sleeps: { left: [], right: [] }, now });
  expect(previewLines(right, moment.utc(now))).toEqual(['No upcoming power or temperature changes.', 'No alarm in the next 2 days.']);
});

it('starts the weekly schedule after a pause ends', () => {
  const value = settings();
  value.right.scheduleOverrides.pause = { active: true, expiresAt: '2026-09-30T12:00:00.000Z' };
  const now = new Date('2026-09-29T10:00:00Z');
  const [, right] = turnOffPreview({ settings: value, schedules: getSchedules(), sleeps: { left: [], right: [] }, now });
  expect(right.paused).toBe(true);
  expect(right.nextOn?.at.format('ddd HH:mm')).toBe('Wed 21:15');
  // The 6:30 AM alarm on Wednesday falls inside the pause.
  expect(alarmLine(right)).toBe('Alarm: the weekly alarm at Thu 6:30 AM.');
});

it('keeps a sleep on through a timed pause, as the Pod does', () => {
  const value = settings();
  value.right.scheduleOverrides.pause = { active: true, expiresAt: '2026-09-30T12:00:00.000Z' };
  const now = new Date('2026-09-29T10:00:00Z');
  const sleeps = { left: [], right: [sleep('2026-09-29T08:00:00.000Z', '2026-09-29T15:30:00.000Z', '2026-09-29T15:15:00.000Z')] };
  const [, right] = turnOffPreview({ settings: value, schedules: getSchedules(), sleeps, now });
  // The weekly night after the pause ends does not cover now, so the sleep runs on, but its alarm falls inside the pause.
  expect(runningSides([right])).toEqual([right]);
  expect(keepOnLabel(right)).toBe("Keep Sam's side on until 3:30 PM");
  expect(previewLines(right, moment.utc(now))).toEqual([
    "Stays on at its current temperature until 3:30 PM. The rest of this sleep's plan stops.",
    'Tomorrow: weekly schedule, 9:15 PM to 6:30 AM.',
    'Its Tue 3:15 PM alarm is paused. Next alarm: the weekly alarm at Thu 6:30 AM.',
  ]);
});

it('does not promise a kept alarm that an alarm override skips', () => {
  const now = new Date('2026-09-29T10:00:00Z');
  const sleeps = { left: [], right: [sleep('2026-09-29T08:00:00.000Z', '2026-09-29T15:30:00.000Z', '2026-09-29T15:15:00.000Z')] };
  // Still active, and one that already expired inside this sleep, both skip its alarms.
  for (const expiresAt of ['2026-09-29T15:30:00.000Z', '2026-09-29T09:00:00.000Z']) {
    const value = settings();
    value.right.scheduleOverrides.alarm = { disabled: true, timeOverride: '', expiresAt };
    const [, right] = turnOffPreview({ settings: value, schedules: getSchedules(), sleeps, now });
    expect(runningSides([right])).toEqual([right]);
    expect(keepOnLabel(right)).toBe("Keep Sam's side on until 3:30 PM");
    expect(alarmLine(right)).toBe('Its Tue 3:15 PM alarm is skipped. Next alarm: the weekly alarm at Wed 6:30 AM.');
  }
});

it('hands a sleep to a weekly night paused until resumed, with no alarm', () => {
  const value = settings();
  value.right.scheduleOverrides.pause = { active: true, expiresAt: '' };
  const now = new Date('2026-09-29T06:30:00Z');
  const sleeps = { left: [], right: [sleep('2026-09-28T22:00:00.000Z', '2026-09-29T07:15:00.000Z', '2026-09-29T07:10:00.000Z')] };
  const [, right] = turnOffPreview({ settings: value, schedules: sevenAmAlarms(), sleeps, now });
  expect(right.weeklyCoversNow).toBe(true);
  expect(runningSides([right])).toEqual([]);
  expect(previewLines(right, moment.utc(now))).toEqual([
    'Now: weekly schedule until 8:30 AM.',
    'No alarm in the next 2 days. The rhythm alarm at Tue 7:10 AM will not ring.',
  ]);
});

it('says a kept evening sleep holds its temperature and its alarms still ring', () => {
  // A 1:00 AM to 11:00 AM sleep, after the weekly night ended at 8:30 AM.
  const evening = sleep('2026-09-29T01:00:00.000Z', '2026-09-29T11:00:00.000Z', '2026-09-29T10:30:00.000Z');
  evening.events.splice(2, 0, { kind: 'alarm', at: '2026-09-29T10:45:00.000Z', alarm, index: 1 });
  const now = new Date('2026-09-29T09:00:00Z');
  const [, right] = turnOffPreview({ settings: settings(), schedules: getSchedules(), sleeps: { left: [], right: [evening] }, now });
  expect(right.weeklyCoversNow).toBe(false);
  expect(previewLines(right, moment.utc(now))[0])
    .toBe("Stays on at its current temperature until 11:00 AM, and its alarms still ring. The rest of tonight's plan stops.");
});

it('reads a sleep kept on past its set off to its actual off', () => {
  // The Pod resolves a "When I get up" sleep kept on for someone in bed to its latest off.
  const [, right] = preview('2026-09-29T16:00:00Z', [sleep('2026-09-29T08:00:00.000Z', '2026-09-29T18:30:00.000Z')]);
  expect(keepOnLabel(right)).toBe("Keep Sam's side on until 6:30 PM");
  expect(previewLines(right, moment.utc('2026-09-29T16:00:00Z'))[0])
    .toBe("Stays on at its current temperature until 6:30 PM. The rest of this sleep's plan stops.");
});
