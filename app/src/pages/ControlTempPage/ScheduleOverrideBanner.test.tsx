import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import moment from 'moment-timezone';
import ScheduleOverrideBanner from './ScheduleOverrideBanner';

const fixture = vi.hoisted(() => ({ pause: { active: false, expiresAt: '' } }));
vi.mock('@state/appStore.tsx', () => ({ useAppStore: () => ({ side: 'left' }) }));
vi.mock('@api/settings.ts', () => ({
  useSettings: () => ({ data: { timeZone: 'UTC', left: { scheduleOverrides: {
    temperatureSchedules: { disabled: true, expiresAt: '2026-09-28T23:00:00Z' },
    pause: fixture.pause,
  } } } }),
  postSettings: vi.fn(),
}));

const renderBanner = () => render(
  <QueryClientProvider client={ new QueryClient() }><ScheduleOverrideBanner/></QueryClientProvider>,
);

beforeEach(() => {
  vi.spyOn(moment, 'now').mockReturnValue(Date.parse('2026-09-28T20:00:00Z'));
  fixture.pause = { active: false, expiresAt: '' };
});
afterEach(() => vi.restoreAllMocks());

it('shows the manual temperature hold while the schedule runs', () => {
  renderBanner();
  expect(screen.getByText('Schedule paused')).toBeInTheDocument();
  expect(screen.getByText('Resumes in 3h 0m')).toBeInTheDocument();
});

it('steps aside while the whole schedule is paused', () => {
  fixture.pause = { active: true, expiresAt: '' };
  renderBanner();
  expect(screen.queryByText('Schedule paused')).not.toBeInTheDocument();
});
