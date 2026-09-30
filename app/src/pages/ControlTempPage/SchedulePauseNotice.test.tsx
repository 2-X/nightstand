import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import moment from 'moment-timezone';
import { AxiosError } from 'axios';
import SchedulePauseNotice from './SchedulePauseNotice';

const fixture = vi.hoisted(() => ({
  side: 'left' as 'left' | 'right',
  pause: { active: true, expiresAt: '' } as { active: boolean; expiresAt: string } | undefined,
  refetchedPause: { active: false, expiresAt: '' },
  postSettings: vi.fn(),
  refetch: vi.fn(),
}));
vi.mock('@state/appStore.tsx', () => ({ useAppStore: () => ({ side: fixture.side }) }));
const settingsWith = (pause: { active: boolean; expiresAt: string } | undefined) => ({
  timeZone: 'UTC',
  left: { scheduleOverrides: { ...(pause ? { pause } : {}) } },
  right: { scheduleOverrides: { pause: { active: true, expiresAt: '' } } },
});
vi.mock('@api/settings.ts', () => ({
  useSettings: () => ({ refetch: fixture.refetch, data: settingsWith(fixture.pause) }),
  postSettings: fixture.postSettings,
}));

beforeEach(() => {
  vi.spyOn(moment, 'now').mockReturnValue(Date.parse('2026-09-28T20:00:00Z'));
  fixture.side = 'left';
  fixture.pause = { active: true, expiresAt: '' };
  fixture.refetchedPause = { active: false, expiresAt: '' };
  fixture.postSettings.mockReset().mockResolvedValue({});
  fixture.refetch.mockReset().mockImplementation(async () => ({ data: settingsWith(fixture.refetchedPause) }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('says when a timed pause ends', () => {
  fixture.pause = { active: true, expiresAt: '2026-09-29T07:00:00Z' };
  render(<SchedulePauseNotice/>);
  expect(screen.getByText('Schedule paused until 7:00 AM tomorrow')).toBeInTheDocument();
});

it('says an open-ended pause waits for a resume', () => {
  render(<SchedulePauseNotice note="Changes you save apply after the pause."/>);
  expect(screen.getByText('Schedule paused until you resume')).toBeInTheDocument();
  expect(screen.getByText('Changes you save apply after the pause.')).toBeInTheDocument();
});

it('renders nothing once the pause has ended', () => {
  fixture.pause = { active: true, expiresAt: '2026-09-28T19:00:00Z' };
  const { container } = render(<SchedulePauseNotice/>);
  expect(container).toBeEmptyDOMElement();
});

it('renders nothing when settings have no pause at all', () => {
  fixture.pause = undefined;
  const { container } = render(<SchedulePauseNotice/>);
  expect(container).toBeEmptyDOMElement();
});

it('drops the notice on the periodic tick once the pause ends', () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  fixture.pause = { active: true, expiresAt: '2026-09-28T20:10:00Z' };
  const { container } = render(<SchedulePauseNotice/>);
  expect(screen.getByRole('button', { name: 'Resume schedule' })).toBeInTheDocument();
  vi.spyOn(moment, 'now').mockReturnValue(Date.parse('2026-09-28T20:11:00Z'));
  act(() => { vi.advanceTimersByTime(30_000); });
  expect(container).toBeEmptyDOMElement();
});

it('renders nothing while the schedule runs', () => {
  fixture.pause = { active: false, expiresAt: '' };
  const { container } = render(<SchedulePauseNotice/>);
  expect(container).toBeEmptyDOMElement();
});

it('resumes the schedule and reloads settings', async () => {
  render(<SchedulePauseNotice/>);
  fireEvent.click(screen.getByRole('button', { name: 'Resume schedule' }));
  await waitFor(() => expect(fixture.refetch).toHaveBeenCalledOnce());
  expect(fixture.postSettings).toHaveBeenCalledWith({ left: { scheduleOverrides: { pause: { active: false, expiresAt: '' } } } });
});

it('marks the resume button as a pause control', () => {
  render(<SchedulePauseNotice/>);
  expect(screen.getByRole('button', { name: 'Resume schedule' })).toHaveAttribute('data-pause-control');
});

it('gives the resume button a phone-sized touch target', () => {
  render(<SchedulePauseNotice/>);
  expect(screen.getByRole('button', { name: 'Resume schedule' })).toHaveStyle({ minHeight: '44px' });
});

it('hands focus on once the resume has saved', async () => {
  const onResumed = vi.fn();
  render(<SchedulePauseNotice onResumed={ onResumed }/>);
  fireEvent.click(screen.getByRole('button', { name: 'Resume schedule' }));
  await waitFor(() => expect(onResumed).toHaveBeenCalledOnce());
  expect(fixture.refetch).toHaveBeenCalledOnce();
});

it('keeps the notice and explains when resuming fails', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  fixture.postSettings.mockRejectedValue(new Error('offline'));
  render(<SchedulePauseNotice/>);
  fireEvent.click(screen.getByRole('button', { name: 'Resume schedule' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not resume the schedule. Try again.');
  expect(screen.getByRole('button', { name: 'Resume schedule' })).toBeEnabled();
});

it('does not hand focus on when resuming fails', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  fixture.postSettings.mockRejectedValue(new Error('offline'));
  const onResumed = vi.fn();
  render(<SchedulePauseNotice onResumed={ onResumed }/>);
  fireEvent.click(screen.getByRole('button', { name: 'Resume schedule' }));
  await screen.findByRole('alert');
  await new Promise(resolve => requestAnimationFrame(() => resolve(null)));
  expect(onResumed).not.toHaveBeenCalled();
});

it('does not hand focus on while the refetched settings are still paused', async () => {
  fixture.refetchedPause = { active: true, expiresAt: '' };
  const onResumed = vi.fn();
  render(<SchedulePauseNotice onResumed={ onResumed }/>);
  fireEvent.click(screen.getByRole('button', { name: 'Resume schedule' }));
  await waitFor(() => expect(fixture.refetch).toHaveBeenCalledOnce());
  await new Promise(resolve => requestAnimationFrame(() => resolve(null)));
  expect(onResumed).not.toHaveBeenCalled();
});

it('stays focusable and ignores repeat clicks while resuming', async () => {
  let finish: (value: unknown) => void = () => {};
  fixture.postSettings.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  render(<SchedulePauseNotice/>);
  const button = screen.getByRole('button', { name: 'Resume schedule' });
  button.focus();
  fireEvent.click(button);
  await waitFor(() => expect(button).toHaveAttribute('aria-disabled', 'true'));
  expect(button).not.toBeDisabled();
  fireEvent.click(button);
  expect(fixture.postSettings).toHaveBeenCalledOnce();
  expect(button).toHaveFocus();
  finish({});
  await waitFor(() => expect(fixture.refetch).toHaveBeenCalledOnce());
});

it('keeps focus on the resume button after a failure', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  fixture.postSettings.mockRejectedValue(new Error('offline'));
  render(<SchedulePauseNotice/>);
  const button = screen.getByRole('button', { name: 'Resume schedule' });
  button.focus();
  fireEvent.click(button);
  await screen.findByRole('alert');
  expect(button).toHaveFocus();
  expect(button).not.toHaveAttribute('aria-disabled', 'true');
});

it('clears the error when the side changes', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  fixture.postSettings.mockRejectedValue(new Error('offline'));
  const { rerender } = render(<SchedulePauseNotice/>);
  fireEvent.click(screen.getByRole('button', { name: 'Resume schedule' }));
  await screen.findByRole('alert');
  fixture.side = 'right';
  rerender(<SchedulePauseNotice/>);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('shows the message the server sent when resuming is refused', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const refusal = new AxiosError('Request failed', 'ERR_BAD_REQUEST', undefined, undefined,
    { status: 400, data: { message: 'Settings could not be saved' } } as never);
  fixture.postSettings.mockRejectedValue(refusal);
  render(<SchedulePauseNotice/>);
  fireEvent.click(screen.getByRole('button', { name: 'Resume schedule' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Settings could not be saved');
});
