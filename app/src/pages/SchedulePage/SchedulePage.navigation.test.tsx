import { StrictMode } from 'react';
import { act, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@test/setup';
import { Link, Route, Routes } from 'react-router-dom';
import { renderWithProviders } from '@test/renderWithProviders';
import { useAppStore } from '@state/appStore';
import { useScheduleStore } from './scheduleStore';
import SchedulePage from './SchedulePage';

afterEach(() => vi.restoreAllMocks());

beforeEach(() => {
  useAppStore.setState({ side: 'left', isUpdating: false });
  useScheduleStore.setState(useScheduleStore.getInitialState(), true);
});

function renderNavigation() {
  return renderWithProviders(<StrictMode>
    <Link to="/">Bed</Link><Link to="/schedules">Schedule</Link>
    <Routes><Route path="/" element={ <div>Bed controls</div> }/><Route path="/schedules" element={ <SchedulePage/> }/></Routes>
  </StrictMode>, { initialRoute: '/schedules' });
}

it('silently discards the edited time and copied days after leaving and returning', async () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  const { user } = renderNavigation();
  await screen.findByRole('switch', { name: /^Schedule \w+ night$/ });
  act(() => {
    useScheduleStore.getState().selectDay(1);
    useScheduleStore.getState().updateSelectedAlarm({ time: '03:33' });
    useScheduleStore.getState().toggleSelectedDay('wednesday');
  });
  await user.click(screen.getByRole('link', { name: 'Bed' }));
  await screen.findByText('Bed controls');
  await user.click(screen.getByRole('link', { name: 'Schedule' }));
  await screen.findByRole('switch', { name: /^Schedule \w+ night$/ });
  expect(screen.queryByRole('status', { name: /^Unsaved/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  expect(useScheduleStore.getState().selectedDays.wednesday).toBe(false);
  act(() => useScheduleStore.getState().selectDay(1));
  expect(useScheduleStore.getState().selectedSchedule?.alarm.time).toBe('07:00');
  expect(confirm).not.toHaveBeenCalled();
});


it('discards edits from both sides when leaving the page', async () => {
  const { user } = renderNavigation();
  await screen.findByRole('switch', { name: /^Schedule \w+ night$/ });
  act(() => {
    useScheduleStore.getState().selectDay(2);
    useScheduleStore.getState().updateSelectedAlarm({ time: '03:33' });
  });
  await user.click(screen.getByRole('link', { name: 'Bed' }));
  act(() => useAppStore.getState().setSide('right'));
  await user.click(screen.getByRole('link', { name: 'Schedule' }));
  await screen.findByRole('switch', { name: /^Schedule \w+ night$/ });
  expect(useScheduleStore.getState().selectedSchedule?.alarm.time).not.toBe('03:33');
  act(() => {
    useScheduleStore.getState().selectDay(4);
    useScheduleStore.getState().updateSelectedAlarm({ time: '04:44' });
  });
  await user.click(screen.getByRole('link', { name: 'Bed' }));
  act(() => useAppStore.getState().setSide('left'));
  await user.click(screen.getByRole('link', { name: 'Schedule' }));
  await screen.findByRole('switch', { name: /^Schedule \w+ night$/ });
  expect(screen.queryByRole('status', { name: /^Unsaved/ })).not.toBeInTheDocument();
  act(() => useScheduleStore.getState().selectDay(2));
  expect(useScheduleStore.getState().selectedSchedule?.alarm.time).toBe('07:00');
  await user.click(screen.getByRole('link', { name: 'Bed' }));
  act(() => useAppStore.getState().setSide('right'));
  await user.click(screen.getByRole('link', { name: 'Schedule' }));
  await screen.findByRole('switch', { name: /^Schedule \w+ night$/ });
  expect(screen.queryByRole('status', { name: /^Unsaved/ })).not.toBeInTheDocument();
  act(() => useScheduleStore.getState().selectDay(4));
  expect(useScheduleStore.getState().selectedSchedule?.alarm.time).toBe('06:30');
});


it('shows the saved schedule on the next visit', async () => {
  const { user } = renderNavigation();
  await screen.findByRole('switch', { name: /^Schedule \w+ night$/ });
  const savedDayIndex = useScheduleStore.getState().selectedDayIndex;
  act(() => useScheduleStore.getState().updateSelectedAlarm({ time: '03:33' }));
  await user.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument(), { timeout: 3000 });
  await user.click(screen.getByRole('link', { name: 'Bed' }));
  await user.click(screen.getByRole('link', { name: 'Schedule' }));
  await screen.findByRole('switch', { name: /^Schedule \w+ night$/ });
  expect(screen.queryByRole('status', { name: /^Unsaved/ })).not.toBeInTheDocument();
  expect(useScheduleStore.getState().changesPresent).toBe(false);
  act(() => useScheduleStore.getState().selectDay(savedDayIndex));
  expect(useScheduleStore.getState().selectedSchedule?.alarm.time).toBe('03:33');
});


it('does not restore submitted edits when navigation happens during the save', async () => {
  let finishSave!: () => void;
  const pendingSave = new Promise<void>(resolve => { finishSave = resolve; });
  server.use(http.post('*/schedules', async () => {
    await pendingSave;
    return HttpResponse.json({});
  }));
  const { user } = renderNavigation();
  await screen.findByRole('switch', { name: /^Schedule \w+ night$/ });
  act(() => useScheduleStore.getState().updateSelectedAlarm({ time: '04:55' }));
  await user.click(screen.getByRole('button', { name: 'Save' }));
  await user.click(screen.getByRole('link', { name: 'Bed' }));
  finishSave();
  await waitFor(() => expect(useAppStore.getState().isUpdating).toBe(false), { timeout: 3000 });
  await user.click(screen.getByRole('link', { name: 'Schedule' }));
  await screen.findByRole('switch', { name: /^Schedule \w+ night$/ });
  expect(screen.queryByRole('status', { name: /^Unsaved/ })).not.toBeInTheDocument();
  expect(useScheduleStore.getState().changesPresent).toBe(false);
});

it.each(['left', 'right'] as const)('preserves newer %s side edits when an earlier save completes', async (side) => {
  let finishSave!: () => void;
  const pendingSave = new Promise<void>(resolve => { finishSave = resolve; });
  server.use(http.post('*/schedules', async () => {
    await pendingSave;
    return HttpResponse.json({});
  }));
  const { user } = renderNavigation();
  await screen.findByRole('switch', { name: /^Schedule \w+ night$/ });
  act(() => useScheduleStore.getState().updateSelectedAlarm({ time: '05:55' }));
  await user.click(screen.getByRole('button', { name: 'Save' }));
  await user.click(screen.getByRole('link', { name: 'Bed' }));
  act(() => useAppStore.getState().setSide(side));
  await user.click(screen.getByRole('link', { name: 'Schedule' }));
  await screen.findByRole('switch', { name: /^Schedule \w+ night$/ });
  await user.click(screen.getByText('Apply settings to other days'));
  await user.click(screen.getByRole('button', { name: 'Weekends' }));
  expect(useScheduleStore.getState().selectedDays.saturday).toBe(true);
  finishSave();
  await waitFor(() => expect(useAppStore.getState().isUpdating).toBe(false), { timeout: 3000 });
  expect(useScheduleStore.getState().selectedDays.saturday).toBe(true);
  expect(screen.getByRole('status', { name: /^Unsaved/ })).toHaveTextContent(side === 'left' ? 'Alex' : 'Sam');
  expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
});
