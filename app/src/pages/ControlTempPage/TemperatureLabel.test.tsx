import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import TemperatureLabel from './TemperatureLabel';

const fixture = vi.hoisted(() => ({ pause: { active: false, expiresAt: '' }, status: undefined as unknown }));
vi.mock('@state/appStore', () => ({ useAppStore: () => ({ side: 'left' }) }));
vi.mock('@api/settings', () => ({ useSettings: () => ({ data: {
  timeZone: 'UTC', left: { awayMode: false, scheduleOverrides: { pause: fixture.pause } },
} }) }));
const night = (on: string) => ({ power: { enabled: true, on, off: '07:00', onTemperature: 82 }, temperatures: {} });
vi.mock('@api/schedules', () => ({ useSchedules: () => ({ data: { left: { monday: night('21:00'), tuesday: night('22:00') } } }) }));
vi.mock('@api/deviceStatus', () => ({ useDeviceStatus: () => ({ data: fixture.status }) }));
vi.mock('./useBedSleeps', () => ({ useBedSleeps: () => ({ state: 'legacy' }) }));

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
