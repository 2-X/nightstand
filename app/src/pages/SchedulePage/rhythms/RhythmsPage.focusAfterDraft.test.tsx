import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '@test/renderWithProviders';
import { server } from '@test/setup';
import { useAppStore } from '@state/appStore';
import { createDemoRhythms, resetMockRhythms } from '../../../mocks/rhythmsMock';
import { useScheduleStore } from '../scheduleStore';
import ScheduleTab from '../ScheduleTab';

vi.mock('@mui/x-charts/LineChart', () => ({
  LineChart: () => <div data-testid="chart"/>,
  lineElementClasses: { root: 'line' },
  areaElementClasses: { root: 'area' },
}));

const swallowRejection = (event: PromiseRejectionEvent) => event.preventDefault();

beforeEach(() => {
  window.addEventListener('unhandledrejection', swallowRejection);
  useAppStore.setState({ side: 'left', isUpdating: false });
  useScheduleStore.setState(useScheduleStore.getInitialState(), true);
  resetMockRhythms(createDemoRhythms(), true);
});
afterEach(() => {
  window.removeEventListener('unhandledrejection', swallowRejection);
  resetMockRhythms();
});

async function editWeekend() {
  renderWithProviders(<ScheduleTab/>);
  fireEvent.click(await screen.findByRole('button', { name: 'Edit Weekend' }));
  fireEvent.change(await screen.findByLabelText('Turn on at'), { target: { value: '23:15' } });
  return screen.findByRole('button', { name: 'Save' });
}

it('moves focus to the rhythm heading after Discard', async () => {
  await editWeekend();
  const discard = screen.getByRole('button', { name: 'Discard' });
  discard.focus();
  fireEvent.click(discard);
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument());
  expect(screen.getByRole('heading', { level: 2, name: 'Weekend' })).toHaveFocus();
});

it('moves focus to the saved rhythm when Save closes the editor', async () => {
  const save = await editWeekend();
  save.focus();
  fireEvent.click(save);
  // Browsers blur a focused button when it becomes disabled.
  save.blur();
  const card = await screen.findByRole('button', { name: 'Edit Weekend' });
  await waitFor(() => expect(card).toHaveFocus());
  await waitFor(() => expect(useAppStore.getState().isUpdating).toBe(false));
});

it('does not take focus back from a control the user moved to during a save', async () => {
  const save = await editWeekend();
  save.focus();
  fireEvent.click(save);
  // Browsers blur a focused button when it becomes disabled.
  save.blur();
  const elsewhere = document.body.appendChild(document.createElement('button'));
  elsewhere.focus();
  await screen.findByRole('button', { name: 'Edit Weekend' });
  expect(elsewhere).toHaveFocus();
  elsewhere.remove();
});

it('moves focus to the reason when the save fails', async () => {
  server.use(http.post('*/rhythms', () => new HttpResponse(null, { status: 500 })));
  const save = await editWeekend();
  save.focus();
  fireEvent.click(save);
  // Browsers blur a focused button when it becomes disabled.
  save.blur();
  const reason = await screen.findByText('Could not save Rhythms. Your changes were not saved. Try again.');
  await waitFor(() => expect(reason.closest('#rhythm-save-error')).toHaveFocus());
});

it('keeps focus on the weekday after a pick saves', async () => {
  const { user } = renderWithProviders(<ScheduleTab/>);
  await user.click(await screen.findByRole('button', { name: 'Fri and Sat: Weekend' }));
  await user.click(within(await screen.findByRole('dialog', { name: 'Fri and Sat' })).getByRole('button', { name: 'Friday' }));
  await user.click(within(await screen.findByRole('dialog', { name: 'Saturday' })).getByRole('button', { name: /^Workday/ }));
  const saturday = await screen.findByRole('button', { name: 'Every day but Fri: Workday' });
  await waitFor(() => expect(useAppStore.getState().isUpdating).toBe(false));
  await waitFor(() => expect(saturday).toHaveFocus());
});

it('moves focus to an unused rhythm\'s card, not its next step, after editing it', async () => {
  const { user } = renderWithProviders(<ScheduleTab/>);
  await user.click(await screen.findByRole('button', { name: 'New rhythm' }));
  await user.click(await screen.findByRole('button', { name: 'Save' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Use Rhythm 3 on some days' })).toHaveFocus());
  await user.click(screen.getByRole('button', { name: 'Edit Rhythm 3' }));
  await user.click(await screen.findByRole('button', { name: 'Rhythms' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Edit Rhythm 3' })).toHaveFocus());
});
