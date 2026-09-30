import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AxiosError } from 'axios';
import moment from 'moment-timezone';
import PauseScheduleSheet from './PauseScheduleSheet';

const fixture = vi.hoisted(() => ({ postSettings: vi.fn(), refetch: vi.fn(), timeZone: 'UTC', partnerAway: false }));
vi.mock('@state/appStore.tsx', () => ({ useAppStore: () => ({ side: 'left' }) }));
vi.mock('@api/settings.ts', () => ({
  useSettings: () => ({ refetch: fixture.refetch, data: {
    timeZone: fixture.timeZone,
    left: { name: 'Alex', awayMode: false },
    right: { name: 'Sam', awayMode: fixture.partnerAway },
  } }),
  postSettings: fixture.postSettings,
}));
const night = (on: string) => ({ power: { enabled: true, on, off: '07:00', onTemperature: 82 }, temperatures: {} });
vi.mock('@api/schedules.ts', () => ({ useSchedules: () => ({ data: { left: {
  monday: night('21:00'), tuesday: night('22:00'),
} } }) }));

type PausePost = { left: { scheduleOverrides: { pause: { active: boolean; expiresAt: string } } } };
const onClose = vi.fn();
const postedPause = () => (fixture.postSettings.mock.calls[0][0] as PausePost).left.scheduleOverrides.pause;

beforeEach(() => {
  // Monday 8:00 PM in the Pod timezone.
  vi.spyOn(moment, 'now').mockReturnValue(Date.parse('2026-09-28T20:00:00Z'));
  fixture.postSettings.mockReset().mockResolvedValue({});
  fixture.refetch.mockReset().mockResolvedValue({});
  onClose.mockReset();
  fixture.timeZone = 'UTC';
  fixture.partnerAway = false;
});
afterEach(() => vi.restoreAllMocks());

it('defaults to tonight only and shows when that ends', () => {
  render(<PauseScheduleSheet open onClose={ onClose }/>);
  expect(screen.getByRole('heading', { name: 'Pause Alex\'s schedule' })).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: /^Tonight only/ })).toBeChecked();
  expect(screen.getByText('until 7:00 AM tomorrow')).toBeInTheDocument();
  expect(screen.getByText(/Your saved schedule is kept/)).toHaveTextContent('Your saved schedule is kept. Sam\'s side is not affected.');
});

it('does not promise the partner\'s side is unaffected while the partner is away', () => {
  // Away mode drives both sides from this side's schedule.
  fixture.partnerAway = true;
  render(<PauseScheduleSheet open onClose={ onClose }/>);
  expect(screen.getByText(/Your saved schedule is kept/)).toHaveTextContent(/^Your saved schedule is kept\.$/);
});

it('pauses until tonight\'s power off', async () => {
  render(<PauseScheduleSheet open onClose={ onClose }/>);
  fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(postedPause().active).toBe(true);
  expect(Date.parse(postedPause().expiresAt)).toBe(Date.parse('2026-09-29T07:00:00Z'));
  expect(fixture.refetch).toHaveBeenCalledOnce();
});

it('pauses until resumed', async () => {
  render(<PauseScheduleSheet open onClose={ onClose }/>);
  fireEvent.click(screen.getByRole('radio', { name: 'Until I resume' }));
  fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(postedPause()).toEqual({ active: true, expiresAt: '' });
});

it('offers the next bedtime as the set time and saves a chosen one', async () => {
  render(<PauseScheduleSheet open onClose={ onClose }/>);
  fireEvent.click(screen.getByRole('radio', { name: 'Until a set time' }));
  const input = screen.getByLabelText('Resume at');
  expect(input).toHaveValue('2026-09-29T22:00');
  fireEvent.change(input, { target: { value: '2026-09-30T18:00' } });
  fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(Date.parse(postedPause().expiresAt)).toBe(Date.parse('2026-09-30T18:00:00Z'));
});

it('sends a chosen time on a whole minute', async () => {
  render(<PauseScheduleSheet open onClose={ onClose }/>);
  fireEvent.click(screen.getByRole('radio', { name: 'Until a set time' }));
  // Some browsers report seconds and milliseconds in a datetime-local value.
  fireEvent.change(screen.getByLabelText('Resume at'), { target: { value: '2026-09-30T18:00:37.250' } });
  fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(Date.parse(postedPause().expiresAt)).toBe(Date.parse('2026-09-30T18:00:00.000Z'));
});

it('blocks a set time in the past or more than 14 days away', () => {
  render(<PauseScheduleSheet open onClose={ onClose }/>);
  fireEvent.click(screen.getByRole('radio', { name: 'Until a set time' }));
  const input = screen.getByLabelText('Resume at');
  fireEvent.change(input, { target: { value: '2026-09-28T19:00' } });
  expect(screen.getByText('Pick a time in the future')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Pause' })).toBeDisabled();
  fireEvent.change(input, { target: { value: '2026-10-20T08:00' } });
  expect(screen.getByText('Pick a time within 14 days')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Pause' })).toBeDisabled();
  fireEvent.change(input, { target: { value: '' } });
  expect(screen.getByText('Pick a date and time')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Pause' })).toBeDisabled();
});

it('stays open and explains when the pause cannot be saved', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  fixture.postSettings.mockRejectedValue(new Error('offline'));
  render(<PauseScheduleSheet open onClose={ onClose }/>);
  fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not pause the schedule. Try again.');
  expect(onClose).not.toHaveBeenCalled();
});

it('shows the server\'s reason and keeps focus on Pause when the save fails', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const failure = new AxiosError('Request failed', 'ERR_BAD_REQUEST', undefined, undefined, {
    status: 400, statusText: 'Bad Request', headers: {}, config: {} as never,
    data: { message: 'Turn off away mode before pausing this side\'s schedule' },
  });
  fixture.postSettings.mockRejectedValue(failure);
  render(<PauseScheduleSheet open onClose={ onClose }/>);
  const pause = screen.getByRole('button', { name: 'Pause' });
  pause.focus();
  fireEvent.click(pause);
  expect(await screen.findByRole('alert')).toHaveTextContent('Turn off away mode before pausing this side\'s schedule');
  expect(pause).toHaveFocus();
  expect(pause).not.toBeDisabled();
});

it('saves once when Pause is pressed twice', async () => {
  let finish: () => void = () => {};
  fixture.postSettings.mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
  render(<PauseScheduleSheet open onClose={ onClose }/>);
  const pause = screen.getByRole('button', { name: 'Pause' });
  fireEvent.click(pause);
  fireEvent.click(pause);
  expect(pause).toHaveAttribute('aria-disabled', 'true');
  finish();
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(fixture.postSettings).toHaveBeenCalledOnce();
});

it('closes without saving on cancel', () => {
  render(<PauseScheduleSheet open onClose={ onClose }/>);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(onClose).toHaveBeenCalledOnce();
  expect(fixture.postSettings).not.toHaveBeenCalled();
});

it('uses the Pod offset for the saved end in a non-UTC zone', async () => {
  fixture.timeZone = 'America/Los_Angeles';
  const { unmount } = render(<PauseScheduleSheet open onClose={ onClose }/>);
  fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(postedPause().expiresAt).toBe('2026-09-29T07:00:00-07:00');
  unmount();

  fixture.postSettings.mockClear();
  onClose.mockClear();
  render(<PauseScheduleSheet open onClose={ onClose }/>);
  fireEvent.click(screen.getByRole('radio', { name: 'Until a set time' }));
  const input = screen.getByLabelText('Resume at');
  expect(input).toHaveValue('2026-09-29T22:00');
  fireEvent.change(input, { target: { value: '2026-09-30T18:00' } });
  fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(postedPause().expiresAt).toBe('2026-09-30T18:00:00-07:00');
});

it('is a labelled modal dialog that opens with focus on the selected option', () => {
  render(<PauseScheduleSheet open onClose={ onClose }/>);
  const dialog = screen.getByRole('dialog', { name: 'Pause Alex\'s schedule' });
  expect(dialog).toHaveAttribute('aria-modal', 'true');
  expect(screen.getByRole('radio', { name: /^Tonight only/ })).toHaveFocus();
});

it('ignores Cancel, the backdrop and Escape while saving, then closes once', async () => {
  let finish: () => void = () => {};
  fixture.postSettings.mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
  render(<PauseScheduleSheet open onClose={ onClose }/>);
  fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  fireEvent.click(document.querySelector('.MuiBackdrop-root') as Element);
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  expect(onClose).not.toHaveBeenCalled();
  finish();
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
});

it('closes on Escape when nothing is saving', () => {
  render(<PauseScheduleSheet open onClose={ onClose }/>);
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  expect(onClose).toHaveBeenCalledOnce();
});
