import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ResolvedSleepResponse } from '@api/rhythmsResponse';
import TemperatureLabel from './TemperatureLabel';
import type { BedSleeps } from './useBedSleeps';

const fixture = vi.hoisted(() => ({
  pause: { active: false, expiresAt: '' }, status: undefined as unknown, away: false, bed: { state: 'legacy' } as BedSleeps,
  live: null as unknown,
}));
vi.mock('@state/appStore', () => ({ useAppStore: () => ({ side: 'left' }) }));
vi.mock('@api/settings', () => ({ useSettings: () => ({ data: {
  timeZone: 'UTC', left: { awayMode: fixture.away, scheduleOverrides: { pause: fixture.pause } },
} }) }));
const night = (on: string) => ({ power: { enabled: true, on, off: '07:00', onTemperature: 82 }, temperatures: {} });
vi.mock('@api/schedules', () => ({ useSchedules: () => ({ data: { left: { monday: night('21:00'), tuesday: night('22:00') } } }) }));
vi.mock('@api/deviceStatus', () => ({ useDeviceStatus: () => ({ data: fixture.status }) }));
vi.mock('./useBedSleeps', () => ({ useBedSleeps: () => fixture.bed }));
vi.mock('@api/rhythms', () => ({ useRhythmsLive: () => ({ data: fixture.live }) }));

const label = (isOn: boolean) => render(<TemperatureLabel
  isOn={ isOn }
  sliderTemp={ 82 }
  sliderColor="#ffffff"
  currentTargetTemp={ 82 }
  currentTemperatureF={ 82 }
  format="level"/>);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  // Monday 8:00 PM.
  vi.setSystemTime(new Date('2026-09-28T20:00:00Z'));
  fixture.pause = { active: true, expiresAt: '2026-09-29T07:00:00.000Z' };
  fixture.status = undefined;
  fixture.away = false;
  fixture.bed = { state: 'legacy' };
  fixture.live = null;
});

const alarm = { time: '06:30', enabled: false, vibrationIntensity: 30, vibrationPattern: 'rise' as const, duration: 30, alarmTemperature: 83 };
// A rhythm sleep from 10:30 PM on `date` to 6:45 AM the next morning (UTC).
const sleep = (date: string, next: string): ResolvedSleepResponse => ({
  side: 'left', date, rhythmId: 'workday', mode: 'manual',
  start: `${date}T22:30:00.000Z`, end: `${next}T06:45:00.000Z`,
  night: { power: { on: '22:30', off: '06:45', onTemperature: 82, enabled: true }, temperatures: {}, alarm, alarms: [] },
  events: [
    { kind: 'power-on', at: `${date}T22:30:00.000Z`, temperatureF: 82 },
    { kind: 'power-off', at: `${next}T06:45:00.000Z` },
  ],
});
afterEach(() => vi.useRealTimers());

it('names when the firmware timer turns a running side off during a pause', () => {
  fixture.status = { left: { isOn: true, secondsRemaining: 5400 } };
  label(true);
  expect(screen.getByText('Turns off at 9:30 PM')).toBeInTheDocument();
  expect(screen.queryByText(/Turns off tonight/)).not.toBeInTheDocument();
});

it('says a running side without a timer stays on during a pause', () => {
  fixture.status = { left: { isOn: true, secondsRemaining: 0 } };
  label(true);
  expect(screen.getByText('Stays on until you turn it off')).toBeInTheDocument();
});

it('names the first start after a timed pause, and none for a pause until resumed', () => {
  const { unmount } = label(false);
  expect(screen.getByText('Turns on tomorrow at 10:00 PM')).toBeInTheDocument();
  unmount();

  fixture.pause = { active: true, expiresAt: '' };
  label(false);
  expect(screen.queryByText(/Turns on/)).not.toBeInTheDocument();
});

it('names the firmware timer when it turns a running side off before the next weekly night', () => {
  fixture.pause = { active: false, expiresAt: '' };
  // Tuesday 10:00 AM, between weekly nights, as after a sleep kept on when Rhythms was turned off.
  vi.setSystemTime(new Date('2026-09-29T10:00:00Z'));
  fixture.status = { left: { isOn: true, secondsRemaining: 5.5 * 3600 } };
  const { unmount } = label(true);
  expect(screen.getByText('Turns off today at 3:30 PM')).toBeInTheDocument();
  unmount();

  // A timer that runs past the next weekly start leaves the weekly turn-off.
  fixture.status = { left: { isOn: true, secondsRemaining: 14 * 3600 } };
  const second = label(true);
  expect(screen.getByText('Turns off tomorrow at 7:00 AM')).toBeInTheDocument();
  second.unmount();

  // An away side shows no schedule text.
  fixture.away = true;
  fixture.status = { left: { isOn: true, secondsRemaining: 5.5 * 3600 } };
  label(true);
  expect(screen.queryByText(/Turns off/)).not.toBeInTheDocument();
});

it('keeps the weekly turn-off during a weekly night', () => {
  fixture.pause = { active: false, expiresAt: '' };
  vi.setSystemTime(new Date('2026-09-28T23:00:00Z'));
  fixture.status = { left: { isOn: true, secondsRemaining: 3600 } };
  label(true);
  expect(screen.getByText('Turns off tomorrow at 7:00 AM')).toBeInTheDocument();
});

it('names the firmware timer under Rhythms after tonight\'s running sleep is removed', () => {
  fixture.pause = { active: false, expiresAt: '' };
  // Tuesday 2:00 AM: Monday night's sleep was set to no sleep while it ran, so the next sleep is Tuesday night.
  vi.setSystemTime(new Date('2026-09-29T02:00:00Z'));
  fixture.bed = { state: 'rhythms', sleeps: [sleep('2026-09-29', '2026-09-30')] };
  fixture.status = { left: { isOn: true, secondsRemaining: 5 * 3600 + 50 * 60 } };
  label(true);
  expect(screen.getByText('Turns off today at 7:50 AM')).toBeInTheDocument();
  expect(screen.queryByText(/Turns off tomorrow/)).not.toBeInTheDocument();
});

it('names the firmware timer under Rhythms after a manual start between sleeps', () => {
  fixture.pause = { active: false, expiresAt: '' };
  // Tuesday 2:00 PM, after Monday night's sleep ended.
  vi.setSystemTime(new Date('2026-09-29T14:00:00Z'));
  fixture.bed = { state: 'rhythms', sleeps: [sleep('2026-09-28', '2026-09-29'), sleep('2026-09-29', '2026-09-30')] };
  fixture.status = { left: { isOn: true, secondsRemaining: 2 * 3600 } };
  const { unmount } = label(true);
  expect(screen.getByText('Turns off today at 4:00 PM')).toBeInTheDocument();
  unmount();

  // A timer that runs past the next sleep's start leaves that sleep's turn-off.
  fixture.status = { left: { isOn: true, secondsRemaining: 10 * 3600 } };
  label(true);
  expect(screen.getByText('Turns off tomorrow at 6:45 AM')).toBeInTheDocument();
});

it('keeps the sleep\'s turn-off under Rhythms while a sleep runs', () => {
  fixture.pause = { active: false, expiresAt: '' };
  vi.setSystemTime(new Date('2026-09-28T23:00:00Z'));
  fixture.bed = { state: 'rhythms', sleeps: [sleep('2026-09-28', '2026-09-29')] };
  fixture.status = { left: { isOn: true, secondsRemaining: 3600 } };
  label(true);
  expect(screen.getByText('Turns off tomorrow at 6:45 AM')).toBeInTheDocument();
});

it('says a "When I get up" sleep turns off when they get up, by its latest off', () => {
  fixture.pause = { active: false, expiresAt: '' };
  vi.setSystemTime(new Date('2026-09-28T23:00:00Z'));
  fixture.status = { left: { isOn: true, secondsRemaining: 8 * 3600 } };
  fixture.bed = { state: 'rhythms', sleeps: [sleep('2026-09-28', '2026-09-29')] };
  fixture.live = { side: 'left', date: '2026-09-28', offWhenUp: { by: '2026-09-29T09:45:00.000Z' } };
  const { unmount } = label(true);
  expect(screen.getByText('Turns off when you get up tomorrow by 9:45 AM')).toBeInTheDocument();
  unmount();

  fixture.live = null;
  label(true);
  expect(screen.getByText('Turns off tomorrow at 6:45 AM')).toBeInTheDocument();
});

it('leaves "when you get up" out during a pause', () => {
  vi.setSystemTime(new Date('2026-09-28T23:00:00Z'));
  fixture.pause = { active: true, expiresAt: '' };
  fixture.status = { left: { isOn: true, secondsRemaining: 0 } };
  fixture.bed = { state: 'rhythms', sleeps: [sleep('2026-09-28', '2026-09-29')] };
  fixture.live = { side: 'left', date: '2026-09-28', offWhenUp: { by: '2026-09-29T09:45:00.000Z' } };
  label(true);
  expect(screen.queryByText(/when you get up/)).not.toBeInTheDocument();
  expect(screen.getByText('Stays on until you turn it off')).toBeInTheDocument();
});
