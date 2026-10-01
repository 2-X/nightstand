import { useEffect, useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import moment from 'moment-timezone';
import UpcomingNight from './UpcomingNight';

const fixture = vi.hoisted(() => ({
  pause: { active: false, expiresAt: '' },
  awayMode: false,
  serverKnowsPause: true,
  listeners: new Set<() => void>(),
  postSettings: vi.fn(),
  refetch: vi.fn(),
}));
vi.mock('@state/appStore.tsx', () => ({ useAppStore: () => ({ side: 'left' }) }));
const settingsData = () => ({
  timeZone: 'UTC', temperatureFormat: 'fahrenheit',
  left: { name: 'Alex', awayMode: fixture.awayMode, scheduleOverrides: {
    temperatureSchedules: { disabled: false, expiresAt: '' },
    ...(fixture.serverKnowsPause ? { pause: fixture.pause } : {}),
  } },
  right: { name: 'Sam', awayMode: false, scheduleOverrides: { pause: { active: false, expiresAt: '' } } },
});
vi.mock('@api/settings.ts', () => ({
  // Like the real query, every consumer re-renders when a refetch lands.
  useSettings: () => {
    const [, bump] = useState(0);
    useEffect(() => {
      const listener = () => bump((value) => value + 1);
      fixture.listeners.add(listener);
      return () => { fixture.listeners.delete(listener); };
    }, []);
    return { refetch: fixture.refetch, data: settingsData() };
  },
  postSettings: fixture.postSettings,
}));
vi.mock('@api/schedules.ts', () => ({ useSchedules: () => ({ data: { left: { monday: {
  power: { enabled: true, on: '21:00', off: '07:00', onTemperature: 82 }, temperatures: {},
} } } }) }));
vi.mock('./AlarmNotification', () => ({ default: () => 'Alarm row' }));
vi.mock('./useBedSleeps', () => ({ useBedSleeps: () => ({ state: 'legacy' }) }));
vi.mock('@api/deviceStatus.ts', () => ({ useDeviceStatus: () => ({ data: undefined }) }));

const renderCard = () => render(<MemoryRouter><UpcomingNight/></MemoryRouter>);

beforeEach(() => {
  vi.spyOn(moment, 'now').mockReturnValue(Date.parse('2026-09-28T20:00:00Z'));
  fixture.pause = { active: false, expiresAt: '' };
  fixture.awayMode = false;
  fixture.serverKnowsPause = true;
  fixture.listeners.clear();
  fixture.postSettings.mockReset().mockImplementation(async (body: { left: { scheduleOverrides: { pause: typeof fixture.pause } } }) => {
    fixture.pause = body.left.scheduleOverrides.pause;
    return {};
  });
  fixture.refetch.mockReset().mockImplementation(async () => {
    // The re-render trails the fetch, as React Query's deferred notification does.
    setTimeout(() => fixture.listeners.forEach((listener) => listener()), 0);
    return { data: settingsData() };
  });
});
afterEach(() => vi.restoreAllMocks());

it('offers a pause next to tonight\'s plan', () => {
  renderCard();
  expect(screen.getByRole('button', { name: 'Pause schedule' })).toBeInTheDocument();
  expect(screen.getByText('Turns on tonight at 9:00 PM, set to 82°F')).toBeInTheDocument();
  expect(screen.getByText('Alarm row')).toBeInTheDocument();
});

it('does not offer a pause when the server does not know about pausing', () => {
  fixture.serverKnowsPause = false;
  renderCard();
  expect(screen.queryByRole('button', { name: 'Pause schedule' })).not.toBeInTheDocument();
  expect(screen.getByText('Turns on tonight at 9:00 PM, set to 82°F')).toBeInTheDocument();
});

it('replaces tonight\'s plan with the paused notice', () => {
  fixture.pause = { active: true, expiresAt: '2026-09-29T07:00:00Z' };
  renderCard();
  expect(screen.getByText('Schedule paused until 7:00 AM tomorrow')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Resume schedule' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Pause schedule' })).not.toBeInTheDocument();
  expect(screen.queryByText(/Turns on/)).not.toBeInTheDocument();
  expect(screen.queryByText('Alarm row')).not.toBeInTheDocument();
});

it('shows an open-ended pause', () => {
  fixture.pause = { active: true, expiresAt: '' };
  renderCard();
  expect(screen.getByText('Schedule paused until you resume')).toBeInTheDocument();
});

it('goes back to tonight\'s plan once the pause has ended', () => {
  fixture.pause = { active: true, expiresAt: '2026-09-28T19:00:00Z' };
  renderCard();
  expect(screen.getByRole('button', { name: 'Pause schedule' })).toBeInTheDocument();
  expect(screen.queryByText(/Schedule paused/)).not.toBeInTheDocument();
});

it('does not offer a pause while the side is away', () => {
  fixture.awayMode = true;
  renderCard();
  expect(screen.getByRole('link', { name: 'Edit schedule' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Pause schedule' })).not.toBeInTheDocument();
});

it('still offers a resume while a paused side is away', () => {
  fixture.awayMode = true;
  fixture.pause = { active: true, expiresAt: '' };
  renderCard();
  expect(screen.getByRole('link', { name: 'Edit schedule' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Resume schedule' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Pause schedule' })).not.toBeInTheDocument();
});

it('opens the pause sheet with tonight only selected', async () => {
  renderCard();
  fireEvent.click(screen.getByRole('button', { name: 'Pause schedule' }));
  expect(await screen.findByRole('radio', { name: /^Tonight only/ })).toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.queryByRole('radio', { name: /^Tonight only/ })).not.toBeInTheDocument());
});

it('keeps keyboard focus on the pause button after the sheet closes', async () => {
  renderCard();
  fireEvent.click(screen.getByRole('button', { name: 'Pause schedule' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Pause schedule' })).toHaveFocus());
});

it('moves focus to the resume button after pausing', async () => {
  renderCard();
  fireEvent.click(screen.getByRole('button', { name: 'Pause schedule' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Pause' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Resume schedule' })).toHaveFocus());
  expect(document.activeElement).not.toBe(document.body);
});

it('moves focus back to the pause button after resuming', async () => {
  fixture.pause = { active: true, expiresAt: '' };
  renderCard();
  fireEvent.click(screen.getByRole('button', { name: 'Resume schedule' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Pause schedule' })).toHaveFocus());
});
