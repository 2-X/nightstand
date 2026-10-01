import { afterEach, beforeEach, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import { server } from '@test/setup';
import { useAppStore } from '@state/appStore';
import { getSchedules, getSettings } from '../../mocks/mockData';
import { createDemoRhythms, getMockRhythms, getMockRhythmsResponse, resetMockRhythms } from '../../mocks/rhythmsMock';
import { useScheduleStore } from './scheduleStore';
import ScheduleTab from './ScheduleTab';

beforeEach(() => {
  useAppStore.setState({ side: 'left', isUpdating: false });
  useScheduleStore.setState(useScheduleStore.getInitialState(), true);
});
afterEach(() => resetMockRhythms());

it('keeps the weekly schedule while Rhythms is off', async () => {
  renderWithProviders(<ScheduleTab/>);
  expect(await screen.findByLabelText('Turn on at')).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Week' })).not.toBeInTheDocument();
});

it('shows the Rhythms screen when Rhythms is on and running', async () => {
  resetMockRhythms(createDemoRhythms(), true);
  renderWithProviders(<ScheduleTab/>);
  expect(await screen.findByRole('heading', { name: 'Week' })).toBeInTheDocument();
  expect(screen.queryByLabelText('Turn on at')).not.toBeInTheDocument();
});

it.each([
  [
    'fingerprint-mismatch',
    'Your weekly schedule changed in another version, so it is running instead of your rhythms. Your rhythms are kept.',
  ],
  ['unsupported-version', /newer version of Nightstand/],
  ['invalid', /could not be read/],
] as const)('explains %s in one line above the weekly schedule', async (reason, text) => {
  resetMockRhythms(null, true);
  server.use(http.get('*/rhythms', () => HttpResponse.json({ status: { enabled: true, active: false, reason }, data: null })));
  renderWithProviders(<ScheduleTab/>);
  expect(await screen.findByText(text)).toBeInTheDocument();
  expect(await screen.findByLabelText('Turn on at')).toBeInTheDocument();
});

it('goes back to Rhythms from the notice after the weekly schedule changed elsewhere', async () => {
  resetMockRhythms(createDemoRhythms(), true);
  let mismatch = true;
  const posts: string[] = [];
  server.use(
    http.get('*/rhythms', () => (mismatch
      ? HttpResponse.json({ status: { enabled: true, active: false, reason: 'fingerprint-mismatch' }, data: getMockRhythms() })
      : HttpResponse.json(getMockRhythmsResponse()))),
    http.post('*/rhythms/enable', () => {
      posts.push('enable');
      mismatch = false;
      return HttpResponse.json({ converted: false });
    }),
  );
  const { user } = renderWithProviders(<ScheduleTab/>);
  expect(await screen.findByText('If you go back to Rhythms, those weekly changes wait until you turn Rhythms off.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Use my weekly schedule' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Go back to Rhythms' }));
  expect(await screen.findByRole('heading', { name: 'Week' })).toBeInTheDocument();
  expect(posts).toEqual(['enable']);
});

it('keeps the weekly schedule from the notice by turning Rhythms off', async () => {
  resetMockRhythms(createDemoRhythms(), true);
  let body: unknown;
  server.use(
    http.get('*/rhythms', () => HttpResponse.json(getSettings().features.rhythms
      ? { status: { enabled: true, active: false, reason: 'fingerprint-mismatch' }, data: null }
      : { status: { enabled: false, active: false, reason: 'flag-off' }, data: null })),
    http.post('*/rhythms/disable', async ({ request }) => {
      body = await request.json();
      resetMockRhythms(null, false);
      return HttpResponse.json({ sides: [] });
    }),
  );
  const { user } = renderWithProviders(<ScheduleTab/>);
  await user.click(await screen.findByRole('button', { name: 'Use my weekly schedule' }));
  await waitFor(() => expect(body).toEqual({ powerOffNow: false }));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Go back to Rhythms' })).not.toBeInTheDocument());
  expect(screen.getByLabelText('Turn on at')).toBeInTheDocument();
});

it('shows the server\'s reason when going back to Rhythms is refused', async () => {
  resetMockRhythms(createDemoRhythms(), true);
  const reason = 'A night in the weekly schedule cannot become a rhythm, for example one with more than 10 alarms. '
    + 'Change that night, then turn Rhythms on.';
  server.use(
    http.get('*/rhythms', () => HttpResponse.json(
      { status: { enabled: true, active: false, reason: 'fingerprint-mismatch' }, data: getMockRhythms() })),
    http.post('*/rhythms/enable', () => HttpResponse.json({ error: reason }, { status: 409 })),
  );
  const { user } = renderWithProviders(<ScheduleTab/>);
  await user.click(await screen.findByRole('button', { name: 'Go back to Rhythms' }));
  expect(await screen.findByText(reason)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Go back to Rhythms' })).toBeEnabled();
});

it('never falls back to the weekly editor when Rhythms cannot load', async () => {
  resetMockRhythms(createDemoRhythms(), true);
  server.use(http.get('*/rhythms', () => HttpResponse.json({ error: 'down' }, { status: 500 })));
  renderWithProviders(<ScheduleTab/>);
  expect(await screen.findByText('Could not load Rhythms.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  expect(screen.queryByLabelText('Turn on at')).not.toBeInTheDocument();
});

it('shows an error, not the weekly editor, when Rhythms runs but its file cannot be read', async () => {
  resetMockRhythms(null, true);
  server.use(http.get('*/rhythms', () => HttpResponse.json({ status: { enabled: true, active: true }, data: { version: 'unreadable' } })));
  renderWithProviders(<ScheduleTab/>);
  expect(await screen.findByText('Could not load Rhythms.')).toBeInTheDocument();
  expect(screen.queryByLabelText('Turn on at')).not.toBeInTheDocument();
});

it('shows the notice while the weekly schedule is still loading', async () => {
  resetMockRhythms(null, true);
  let release = () => {};
  const held = new Promise<void>(resolve => { release = resolve; });
  server.use(
    http.get('*/rhythms', () => HttpResponse.json({ status: { enabled: true, active: false, reason: 'invalid' }, data: null })),
    http.get('*/schedules', async () => {
      await held;
      return HttpResponse.json(getSchedules());
    }),
  );
  renderWithProviders(<ScheduleTab/>);
  expect(await screen.findByText(/could not be read/)).toBeInTheDocument();
  expect(screen.queryByLabelText('Turn on at')).not.toBeInTheDocument();
  release();
  expect(await screen.findByLabelText('Turn on at')).toBeInTheDocument();
  expect(screen.getByText(/could not be read/)).toBeInTheDocument();
});

it('asks before going back to Rhythms drops a weekly draft', async () => {
  resetMockRhythms(createDemoRhythms(), true);
  let mismatch = true;
  const posts: string[] = [];
  server.use(
    http.get('*/rhythms', () => (mismatch
      ? HttpResponse.json({ status: { enabled: true, active: false, reason: 'fingerprint-mismatch' }, data: getMockRhythms() })
      : HttpResponse.json(getMockRhythmsResponse()))),
    http.post('*/rhythms/enable', () => {
      posts.push('enable');
      mismatch = false;
      return HttpResponse.json({ converted: false });
    }),
  );
  const { user } = renderWithProviders(<ScheduleTab/>);
  const back = await screen.findByRole('button', { name: 'Go back to Rhythms' });
  fireEvent.change(await screen.findByLabelText('Turn on at'), { target: { value: '23:15' } });
  await user.click(back);
  let dialog = await screen.findByRole('dialog', { name: /^Discard changes to / });
  await user.click(within(dialog).getByRole('button', { name: 'Keep editing' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(posts).toEqual([]);
  expect(screen.getByLabelText('Turn on at')).toHaveValue('23:15');
  await user.click(screen.getByRole('button', { name: 'Go back to Rhythms' }));
  dialog = await screen.findByRole('dialog', { name: /^Discard changes to / });
  await user.click(within(dialog).getByRole('button', { name: 'Discard' }));
  expect(await screen.findByRole('heading', { name: 'Week' })).toBeInTheDocument();
  expect(posts).toEqual(['enable']);
});

it('drops a discarded weekly draft when going back to Rhythms is refused', async () => {
  resetMockRhythms(createDemoRhythms(), true);
  server.use(
    http.get('*/rhythms', () => HttpResponse.json(
      { status: { enabled: true, active: false, reason: 'fingerprint-mismatch' }, data: getMockRhythms() })),
    http.post('*/rhythms/enable', () => HttpResponse.json({ error: 'Rhythms data is from a newer version.' }, { status: 409 })),
  );
  const { user } = renderWithProviders(<ScheduleTab/>);
  const back = await screen.findByRole('button', { name: 'Go back to Rhythms' });
  const turnOn = await screen.findByLabelText('Turn on at');
  const saved = (turnOn as HTMLInputElement).value;
  fireEvent.change(turnOn, { target: { value: '23:15' } });
  await user.click(back);
  await user.click(within(await screen.findByRole('dialog', { name: /^Discard changes to / })).getByRole('button', { name: 'Discard' }));
  expect(await screen.findByText('Rhythms data is from a newer version.')).toBeInTheDocument();
  expect(screen.getByLabelText('Turn on at')).toHaveValue(saved);
  expect(useScheduleStore.getState().changesPresent).toBe(false);
});
