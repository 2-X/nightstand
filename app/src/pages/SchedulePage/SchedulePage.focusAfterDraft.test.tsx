import { afterEach, beforeEach, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '@test/renderWithProviders';
import { server } from '@test/setup';
import { useAppStore } from '@state/appStore';
import { useScheduleStore } from './scheduleStore';
import SchedulePage from './SchedulePage';

// The mock server keeps saved schedules, so each test that saves needs a value no earlier test used.
const swallowRejection = (event: PromiseRejectionEvent) => event.preventDefault();

beforeEach(() => {
  window.addEventListener('unhandledrejection', swallowRejection);
  useAppStore.setState({ side: 'left', isUpdating: false });
  useScheduleStore.setState(useScheduleStore.getInitialState(), true);
});
afterEach(() => window.removeEventListener('unhandledrejection', swallowRejection));

async function editSchedule(powerOn: string) {
  renderWithProviders(<SchedulePage/>);
  await screen.findByLabelText('Turn on at');
  fireEvent.change(screen.getByLabelText('Turn on at'), { target: { value: powerOn } });
  return screen.findByRole('button', { name: 'Save' });
}

const nightHeading = () => screen.getByRole('heading', { level: 2, name: /^[A-Z][a-z]+ night/ });

it('moves focus to the night heading after Discard', async () => {
  await editSchedule('21:31');
  const discard = screen.getByRole('button', { name: 'Discard' });
  discard.focus();
  fireEvent.click(discard);
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument());
  expect(nightHeading()).toHaveFocus();
});

it('moves focus to the night heading after Save', async () => {
  const save = await editSchedule('21:32');
  save.focus();
  fireEvent.click(save);
  // Browsers blur a focused button when it becomes disabled.
  save.blur();
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument(), { timeout: 4000 });
  expect(nightHeading()).toHaveFocus();
  await waitFor(() => expect(useAppStore.getState().isUpdating).toBe(false));
});

it('does not take focus back from a control the user moved to during a save', async () => {
  const save = await editSchedule('21:33');
  save.focus();
  fireEvent.click(save);
  // Browsers blur a focused button when it becomes disabled.
  save.blur();
  const elsewhere = document.body.appendChild(document.createElement('button'));
  elsewhere.focus();
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument(), { timeout: 4000 });
  expect(elsewhere).toHaveFocus();
  elsewhere.remove();
});

it('returns focus to Save when the save fails', async () => {
  server.use(http.post('*/schedules', () => new HttpResponse(null, { status: 500 })));
  const save = await editSchedule('21:34');
  save.focus();
  fireEvent.click(save);
  // Browsers blur a focused button when it becomes disabled.
  save.blur();
  await screen.findByRole('alert');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toHaveFocus());
});
