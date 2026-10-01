import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import { server } from '@test/setup';
import { getDeviceStatus, getSchedules } from '../../../mocks/mockData';
import { createDemoRhythms, resetMockRhythms } from '../../../mocks/rhythmsMock';
import DisableRhythmsDialog from './DisableRhythmsDialog';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-29T17:00:00Z'));
  resetMockRhythms(createDemoRhythms(), true);
});
afterEach(() => {
  vi.useRealTimers();
  resetMockRhythms();
});

function renderDialog() {
  const onClose = vi.fn();
  const onDone = vi.fn();
  const view = renderWithProviders(<DisableRhythmsDialog onClose={ onClose } onDone={ onDone }/>);
  return { ...view, onClose, onDone };
}

it('lists what happens next under the weekly schedule', async () => {
  renderDialog();
  const dialog = await screen.findByRole('dialog', { name: 'Turn off Rhythms?' });
  expect(dialog).toHaveTextContent('The weekly schedule comes back exactly as it was. Your rhythms are kept for next time.');
  expect(await within(dialog).findByRole('heading', { name: 'Sam', level: 3 })).toBeInTheDocument();
  expect(within(dialog).getByText(
    "Stays on at its current temperature until 3:30 PM, and its alarm still rings. The rest of this sleep's plan stops.")).toBeInTheDocument();
  expect(within(dialog).getByText(/^Alarm: Tue 3:15 PM still rings\. After that, the weekly alarm at /)).toBeInTheDocument();
  expect(within(dialog).getAllByText(/^(Today|Tonight|Tomorrow|\w{3}): weekly schedule, /).length).toBeGreaterThan(0);
});

it('offers to keep the bed on during a sleep and sends the choice', async () => {
  let body: unknown;
  server.use(http.post('*/rhythms/disable', async ({ request }) => {
    body = await request.json();
    return HttpResponse.json({ sides: [] });
  }));
  const { user, onClose, onDone } = renderDialog();
  expect(await screen.findByRole('radiogroup', { name: "Sam's rhythm sleep is in progress" })).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: "Keep Sam's side on until 3:30 PM (its 3:15 PM alarm still rings)" })).toBeChecked();
  await user.click(screen.getByRole('radio', { name: 'Turn off now' }));
  expect(screen.getByText(/^Alarm: the weekly alarm at .* rings instead of Tue 3:15 PM\.$/)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Turn off Rhythms' }));
  await waitFor(() => expect(body).toEqual({ powerOffNow: true }));
  await waitFor(() => expect(onDone).toHaveBeenCalledWith('Rhythms is off.', 'success'));
  expect(onClose).toHaveBeenCalled();
});

it('warns when the Pod could not change a side', async () => {
  server.use(http.post('*/rhythms/disable', () => {
    resetMockRhythms(createDemoRhythms(), false);
    return HttpResponse.json({ sides: [{ side: 'right', action: 'powered-off', alarmOverrideSet: false, deviceUpdateFailed: true }] });
  }));
  const { user, onDone } = renderDialog();
  await user.click(await screen.findByRole('radio', { name: 'Turn off now' }));
  await user.click(screen.getByRole('button', { name: 'Turn off Rhythms' }));
  await waitFor(() => expect(onDone).toHaveBeenCalledWith('Rhythms is off. Could not reach the Pod, so Sam was not changed.', 'warning'));
});

it('says Rhythms is still on when turning it off fails', async () => {
  server.use(http.post('*/rhythms/disable', () => new HttpResponse(null, { status: 500 })));
  const { user, onClose } = renderDialog();
  const confirm = await screen.findByRole('button', { name: 'Turn off Rhythms' });
  await waitFor(() => expect(confirm).toBeEnabled());
  await user.click(confirm);
  expect(await screen.findByText('Could not turn off Rhythms. Rhythms is still on. Try again.')).toBeInTheDocument();
  expect(onClose).not.toHaveBeenCalled();
});

it('shows the server\'s reason when turning it off fails', async () => {
  server.use(http.post('*/rhythms/disable', () => HttpResponse.json(
    { error: { message: 'Pod hardware is not connected. Try again in a moment.' } }, { status: 503 })));
  const { user } = renderDialog();
  const confirm = await screen.findByRole('button', { name: 'Turn off Rhythms' });
  await waitFor(() => expect(confirm).toBeEnabled());
  await user.click(confirm);
  expect(await screen.findByText('Could not turn off Rhythms. Pod hardware is not connected. Try again in a moment. Rhythms is still on.'))
    .toBeInTheDocument();
});

it('reports Rhythms off when a failed request went through after all', async () => {
  server.use(http.post('*/rhythms/disable', () => {
    resetMockRhythms(createDemoRhythms(), false);
    return new HttpResponse(null, { status: 504 });
  }));
  const { user, onClose, onDone } = renderDialog();
  const confirm = await screen.findByRole('button', { name: 'Turn off Rhythms' });
  await waitFor(() => expect(confirm).toBeEnabled());
  await user.click(confirm);
  await waitFor(() => expect(onDone).toHaveBeenCalledWith('Rhythms is off, but the Pod did not confirm what each side did. '
    + 'Check the Bed page.', 'warning'));
  expect(onClose).toHaveBeenCalled();
});

it('names both sides when turning off now stops two sleeps', async () => {
  const db = createDemoRhythms();
  db.left.rhythms['night-shift'] = structuredClone(db.right.rhythms['night-shift']);
  db.left.week.tuesday = 'night-shift';
  resetMockRhythms(db, true);
  renderDialog();
  expect(await screen.findByRole('radiogroup', { name: 'Both sides are in a rhythm sleep' })).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: 'Keep both sides on until their sleeps end' })).toBeChecked();
  expect(screen.getByRole('radio', { name: 'Turn off both sides now' })).toBeInTheDocument();
});

it('leaves a side that is off out of the keep-on choice', async () => {
  server.use(http.get('*/deviceStatus', () => HttpResponse.json({
    ...getDeviceStatus(), right: { ...getDeviceStatus().right, isOn: false },
  })));
  renderDialog();
  const dialog = await screen.findByRole('dialog', { name: 'Turn off Rhythms?' });
  expect(await within(dialog).findByRole('heading', { name: 'Sam' })).toBeInTheDocument();
  expect(within(dialog).queryByText(/^Now: this rhythm's sleep/)).not.toBeInTheDocument();
  expect(within(dialog).queryByRole('radiogroup')).not.toBeInTheDocument();
});

it('offers to keep one side on and names both when the other is in a sleep the weekly schedule covers', async () => {
  const db = createDemoRhythms();
  db.left.rhythms['night-shift'] = structuredClone(db.right.rhythms['night-shift']);
  db.left.week.tuesday = 'night-shift';
  resetMockRhythms(db, true);
  // Alex's Monday weekly night runs to 11:00 AM, so it covers Alex's sleep now.
  const schedules = structuredClone(getSchedules());
  schedules.left.monday.power.off = '11:00';
  server.use(http.get('*/schedules', () => HttpResponse.json(schedules)));
  renderDialog();
  expect(await screen.findByRole('radiogroup', { name: "Sam's rhythm sleep is in progress" })).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: "Keep Sam's side on until 3:30 PM (its 3:15 PM alarm still rings)" })).toBeChecked();
  expect(screen.getByRole('radio', { name: 'Turn off both sides now' })).toBeInTheDocument();
  expect(screen.getByText('Now: weekly schedule until 11:00 AM.')).toBeInTheDocument();
});
