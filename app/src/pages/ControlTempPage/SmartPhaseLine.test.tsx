import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ResolvedSleepResponse, RhythmsLive } from '@api/rhythmsResponse';
import SmartPhaseLine from './SmartPhaseLine';

const fixture = vi.hoisted(() => ({ live: null as RhythmsLive | null, liveError: false, statusAge: 0 }));
vi.mock('@api/rhythms', () => ({ useRhythmsLive: () => ({ data: fixture.live, isError: fixture.liveError }) }));
vi.mock('@api/settings', () => ({ useSettings: () => ({ data: { timeZone: 'America/Los_Angeles', temperatureFormat: 'level' } }) }));
vi.mock('@state/appStore', () => ({ useAppStore: () => ({ side: 'left' }) }));
// -1 in levels: the level the manual change set.
vi.mock('@api/deviceStatus', () => ({ useDeviceStatus: () => ({
  data: { left: { isOn: true, targetTemperatureF: 80, currentTemperatureF: 80 } },
  dataUpdatedAt: Date.now() - fixture.statusAge, isError: false, isFetching: false, failureCount: 0, errorUpdateCount: 0, errorUpdatedAt: 0,
}) }));

const alarm = { time: '06:30', enabled: true, vibrationIntensity: 30, vibrationPattern: 'rise' as const, duration: 30, alarmTemperature: 83 };
const sleep: ResolvedSleepResponse = {
  side: 'left', date: '2026-09-28', rhythmId: 'workday', mode: 'smart',
  start: '2026-09-29T05:00:00.000Z', end: '2026-09-29T13:45:00.000Z', wake: '2026-09-29T13:30:00.000Z',
  night: { power: { on: '22:30', off: '06:45', onTemperature: 83, enabled: true }, temperatures: {}, alarm, alarms: [alarm] },
  smart: { baseLevel: 0, intensity: 'standard', warmStart: true, warmUp: true, upEarly: false },
  events: [{ kind: 'alarm', at: '2026-09-29T13:30:00.000Z', alarm, index: 0 }],
};
const live = (over: Partial<RhythmsLive>): RhythmsLive => ({
  side: 'left', date: '2026-09-28', phase: 'hold', waiting: false, coolStart: '2026-09-29T05:30:00.000Z',
  hold: null, baseSince: null, nextChange: null, ...over,
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-29T09:00:00Z'));
  fixture.live = null;
  fixture.liveError = false;
  fixture.statusAge = 0;
});
afterEach(() => vi.useRealTimers());

it('shows a hold the server keeps in memory, with the level the manual change set', () => {
  fixture.live = live({ hold: { until: '2026-09-29T12:00:00.000Z' } });
  render(<SmartPhaseLine sleep={ sleep } side="left"/>);
  expect(screen.getByText('Holding \u22121 until 5:00 AM')).toBeInTheDocument();
});

it('says the cool-down waits for bed entry while the server waits', () => {
  vi.setSystemTime(new Date('2026-09-29T05:45:00Z'));
  fixture.live = live({ phase: 'bedtime', waiting: true });
  render(<SmartPhaseLine sleep={ sleep } side="left"/>);
  expect(screen.getByText("Starts cooling once you've settled in bed")).toBeInTheDocument();
});

it('follows the clock curve when no night is live, keeping "wake-up" in one piece', () => {
  const { container } = render(<SmartPhaseLine sleep={ sleep } side="left"/>);
  expect(container.querySelector('p')).toHaveTextContent('Warm-up starts at 5:45 AM for your 6:30 AM wake-up');
  expect(screen.getByText('wake-up')).toHaveStyle({ whiteSpace: 'nowrap' });
});

it('follows a cool-down the server delayed', () => {
  vi.setSystemTime(new Date('2026-09-29T06:15:00Z'));
  fixture.live = live({ phase: 'bedtime', coolStart: '2026-09-29T06:30:00.000Z' });
  render(<SmartPhaseLine sleep={ sleep } side="left"/>);
  // An hour later than the clock curve's 11:40 PM.
  expect(screen.getByText('Cooling step by step to \u22122 by 12:40 AM')).toBeInTheDocument();
});

it('says when the server went back to the base', () => {
  vi.setSystemTime(new Date('2026-09-29T13:00:00Z'));
  fixture.live = live({ phase: 'after', baseSince: '2026-09-29T12:50:00.000Z' });
  render(<SmartPhaseLine sleep={ sleep } side="left"/>);
  expect(screen.getByText('Back at your base, 0, since 5:50 AM')).toBeInTheDocument();
});

it('drops the presence-driven cool-down when the live answer could not be read', () => {
  vi.setSystemTime(new Date('2026-09-29T05:45:00Z'));
  fixture.live = live({ phase: 'bedtime', waiting: true });
  fixture.liveError = true;
  const { container } = render(<SmartPhaseLine sleep={ sleep } side="left"/>);
  expect(container).toBeEmptyDOMElement();
});

it('drops the cool-down while there is no live answer for tonight', () => {
  vi.setSystemTime(new Date('2026-09-29T05:45:00Z'));
  const { container } = render(<SmartPhaseLine sleep={ sleep } side="left"/>);
  expect(container).not.toHaveTextContent('Cooling step by step');
  expect(container).toBeEmptyDOMElement();
});

it('shows no line while the bed has not reported for two minutes', () => {
  fixture.statusAge = 3 * 60_000;
  fixture.live = live({ hold: { until: '2026-09-29T12:00:00.000Z' } });
  const { container } = render(<SmartPhaseLine sleep={ sleep } side="left"/>);
  expect(container).toBeEmptyDOMElement();
});
