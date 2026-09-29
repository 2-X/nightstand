import { afterEach, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import moment from 'moment-timezone';
import { ThemeProvider } from '@mui/material/styles';
import { theme } from '../../theme';
import UpcomingNight from './UpcomingNight';

const fixture = vi.hoisted(() => ({ expiresAt: '2026-09-28T20:00:00Z', on: '19:00' }));
vi.mock('@state/appStore.tsx', () => ({ useAppStore: () => ({ side: 'left' }) }));
vi.mock('@api/settings.ts', () => ({ useSettings: () => ({ data: {
  timeZone: 'UTC', temperatureFormat: 'fahrenheit', left: { awayMode: false,
    scheduleOverrides: { temperatureSchedules: { disabled: true, expiresAt: fixture.expiresAt } },
  },
} }) }));
vi.mock('@api/schedules.ts', () => ({ useSchedules: () => ({ data: { left: { monday: {
  power: { enabled: true, on: fixture.on, off: '09:00', onTemperature: 82 }, temperatures: { '22:00': 70 },
} } } }) }));
vi.mock('./AlarmNotification', () => ({ default: () => null }));
afterEach(() => vi.restoreAllMocks());

it('does not label future events as paused after an override expires', () => {
  vi.spyOn(moment, 'now').mockReturnValue(Date.parse('2026-09-28T21:00:00Z'));
  fixture.on = '19:00';
  fixture.expiresAt = '2026-09-28T20:00:00Z';
  render(<MemoryRouter><UpcomingNight/></MemoryRouter>);
  expect(screen.getByText(/Changes to/)).not.toHaveTextContent('paused');
});

it('explains that an active manual override keeps the manual target at power-on', () => {
  vi.spyOn(moment, 'now').mockReturnValue(Date.parse('2026-09-28T20:00:00Z'));
  fixture.on = '21:00';
  fixture.expiresAt = '2026-09-29T08:00:00Z';
  render(<MemoryRouter><UpcomingNight/></MemoryRouter>);
  expect(screen.getByText('Turns on tonight at 9:00 PM and keeps your manual temperature')).toBeInTheDocument();
});

it('places the power-on time before the target temperature', () => {
  vi.spyOn(moment, 'now').mockReturnValue(Date.parse('2026-09-28T20:00:00Z'));
  fixture.on = '21:00';
  fixture.expiresAt = '2026-09-28T19:00:00Z';
  render(<MemoryRouter><UpcomingNight/></MemoryRouter>);
  expect(screen.getByText('Turns on tonight at 9:00 PM, set to 82°F')).toBeInTheDocument();
});

it('shows the following temperature event when power-on is already shown in the off readout', () => {
  vi.spyOn(moment, 'now').mockReturnValue(Date.parse('2026-09-28T20:00:00Z'));
  fixture.on = '21:00';
  fixture.expiresAt = '2026-09-28T19:00:00Z';
  render(<MemoryRouter><UpcomingNight isOn={ false }/></MemoryRouter>);
  expect(screen.getByText('Changes to 70°F tonight at 10:00 PM')).toBeInTheDocument();
  expect(screen.queryByText(/Turns on/)).not.toBeInTheDocument();
});


it('uses the shared section hierarchy for upcoming events', () => {
  vi.spyOn(moment, 'now').mockReturnValue(Date.parse('2026-09-28T12:00:00Z'));
  fixture.on = '21:00';
  render(<ThemeProvider theme={ theme }><MemoryRouter><UpcomingNight/></MemoryRouter></ThemeProvider>);
  expect(screen.getByRole('heading', { level: 2, name: 'Upcoming' }))
    .toHaveStyle({ fontSize: '1.125rem', fontWeight: 600 });
});
