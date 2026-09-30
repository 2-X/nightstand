import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '@test/renderWithProviders';
import { server } from '@test/setup';
import { getSchedules, getSettings } from '../../mocks/mockData';
import SchedulePage from './SchedulePage';
import { useScheduleStore } from './scheduleStore';

beforeEach(() => useScheduleStore.setState(useScheduleStore.getInitialState(), true));

it('groups editable events and marks the side/day draft scope', async () => {
  const schedules = structuredClone(getSchedules());
  for (const day of Object.values(schedules.left)) {
    day.power = { ...day.power, on: '21:00', off: '09:00' };
    day.temperatures = { '01:00': 70 };
    day.alarms = [{ ...day.alarm, enabled: true, time: '23:00' }, { ...day.alarm, enabled: true, time: '08:00' }];
    day.alarm = day.alarms[0];
  }
  server.use(http.get('*/schedules', () => HttpResponse.json(schedules)));
  renderWithProviders(<SchedulePage />);
  await waitFor(() => expect(screen.getAllByLabelText('Wake at')).toHaveLength(2));
  const events = screen.getAllByTestId('schedule-event');
  expect(events.map(row => row.querySelector('input[type="time"]')?.getAttribute('value')))
    .toEqual(['21:00', '23:00', '01:00', '08:00', undefined]);
  expect(screen.getByText('Turns off at 9:00 AM')).toBeInTheDocument();
  fireEvent.change(screen.getAllByLabelText('Wake at')[1], { target: { value: '08:30' } });
  expect(screen.getByRole('status')).toHaveTextContent(/Unsaved.*Alex/);
  expect(screen.queryByRole('button', { name: 'Save one-time alarm' })).not.toBeInTheDocument();
});

it('preserves both inline adjustments when an edited time collides', async () => {
  const schedules = structuredClone(getSchedules());
  for (const day of Object.values(schedules.left)) {
    day.power = { ...day.power, enabled: true, on: '21:00', off: '09:00' };
    day.temperatures = { '01:00': 60, '02:00': 80 };
  }
  server.use(http.get('*/schedules', () => HttpResponse.json(schedules)));
  renderWithProviders(<SchedulePage />);
  await waitFor(() => expect(screen.getAllByLabelText('Change at')).toHaveLength(2));
  fireEvent.change(screen.getAllByLabelText('Change at')[0], { target: { value: '02:00' } });
  expect(screen.getByRole('alert')).toHaveTextContent(/already exists/);
  expect(screen.getAllByLabelText('Change at').map(input => (input as HTMLInputElement).value)).toEqual(['01:00', '02:00']);
});

it('places the full-day power-off after all events and names each alarm switch', async () => {
  const schedules = structuredClone(getSchedules());
  for (const day of Object.values(schedules.left)) {
    day.power = { ...day.power, enabled: true, on: '21:00', off: '21:00' };
    day.temperatures = { '01:00': 70 };
    day.alarms = [{ ...day.alarm, enabled: true, time: '08:00' }];
    day.alarm = day.alarms[0];
  }
  server.use(http.get('*/schedules', () => HttpResponse.json(schedules)));
  renderWithProviders(<SchedulePage />);
  await screen.findByLabelText('Change at');
  const events = screen.getAllByTestId('schedule-event');
  expect(events.map(row => row.querySelector('input[type="time"]')?.getAttribute('value')))
    .toEqual(['21:00', '01:00', '08:00', '21:00']);
  expect(screen.getByRole('switch', { name: 'Enable alarm 1' })).toBeChecked();
});

it('can add a temperature adjustment inside a thirty-minute power window', async () => {
  const schedules = structuredClone(getSchedules());
  for (const day of Object.values(schedules.left)) {
    day.power = { ...day.power, enabled: true, on: '21:00', off: '21:30' };
    day.temperatures = {};
    day.alarms = [{ ...day.alarm, enabled: true, time: '21:15' }];
    day.alarm = day.alarms[0];
  }
  server.use(http.get('*/schedules', () => HttpResponse.json(schedules)));
  renderWithProviders(<SchedulePage />);
  await screen.findByLabelText('Wake at');
  fireEvent.click(screen.getByRole('button', { name: 'Add temperature change' }));
  expect(screen.getByLabelText('Change at')).toHaveValue('21:15');
});

it('waits for the Pod timezone before exposing editable schedule controls', async () => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  server.use(http.get('*/settings', async () => {
    await pending;
    return HttpResponse.json(getSettings());
  }));
  const { queryClient } = renderWithProviders(<SchedulePage/>);
  try {
    await waitFor(() => expect(queryClient.getQueryState(['useSchedules'])?.status).toBe('success'));
    expect(screen.queryByLabelText('Turn on at')).not.toBeInTheDocument();
  } finally {
    release();
  }
  expect(await screen.findByLabelText('Turn on at')).toBeEnabled();
});

it('keeps draft errors compact and focuses the invalid row on request', async () => {
  const scroll = vi.spyOn(Element.prototype, 'scrollIntoView');
  renderWithProviders(<SchedulePage/>);
  const adjustments = await screen.findAllByLabelText('Change at');
  fireEvent.change(adjustments[0], { target: { value: '15:00' } });
  expect(screen.queryByText('Check every alarm and temperature time against the power window before saving.')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Fix 1 time' }));
  expect(screen.getByDisplayValue('15:00')).toHaveFocus();
  expect(scroll).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });
  scroll.mockRestore();
});

it('collapses a disabled night and restores its saved editor when enabled', async () => {
  renderWithProviders(<SchedulePage/>);
  const enabled = await screen.findByRole('switch', { name: /^Schedule \w+ night$/ });
  await screen.findByLabelText('Turn on at');
  fireEvent.click(enabled);
  expect(screen.getByText('This night is off')).toBeInTheDocument();
  expect(screen.queryByLabelText('Turn on at')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Night temperature chart')).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent(/Unsaved: .*Alex/);
  fireEvent.click(enabled);
  expect(screen.getByLabelText('Turn on at')).toBeInTheDocument();
  expect(screen.queryByText('This night is off')).not.toBeInTheDocument();
});
