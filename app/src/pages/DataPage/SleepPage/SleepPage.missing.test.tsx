import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import moment from 'moment-timezone';
import { renderWithProviders } from '@test/renderWithProviders';
import { server } from '@test/setup';
import { getSettings, getServices } from '../../../mocks/mockData';
import { createDemoRhythms, resetMockRhythms } from '../../../mocks/rhythmsMock';
import { useAppStore } from '@state/appStore';
import SleepPage from './SleepPage';
import { RHYTHMS_PENDING_DESCRIPTION } from './MissingNightCard';

let services: ReturnType<typeof getServices>;
let settings: ReturnType<typeof getSettings>;
let jobs: unknown[];
const older = {
  id: 1, side: 'left', entered_bed_at: '2026-09-26T06:00:00Z', left_bed_at: '2026-09-26T14:00:00Z',
  sleep_period_seconds: 28800, times_exited_bed: 0, present_intervals: [], not_present_intervals: [],
};
beforeEach(() => {
  vi.spyOn(moment, 'now').mockReturnValue(Date.parse('2026-09-27T17:00:00Z'));
  useAppStore.setState({ side: 'left', isUpdating: false });
  services = structuredClone(getServices());
  settings = { ...structuredClone(getSettings()), timeZone: 'America/Los_Angeles' };
  services.biometrics.jobs.analyzeSleepLeft = {
    ...services.biometrics.jobs.analyzeSleepLeft, status: 'healthy', timestamp: '2026-09-26T19:00:00Z',
  };
  jobs = [];
  server.use(
    http.get('*/settings', () => HttpResponse.json(settings)),
    http.get('*/services', () => HttpResponse.json(services)),
    http.get('*/metrics/sleep', () => HttpResponse.json([])),
    http.post('*/jobs', async ({ request }) => { jobs.push(await request.json()); return HttpResponse.json({}); }),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  resetMockRhythms();
});
it('runs the existing analysis job once and presents progress', async () => {
  const { user } = renderWithProviders(<SleepPage/>);
  expect(await screen.findByText('Not ready yet')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Analyze now' }));
  expect(await screen.findByText('Analyzing last night')).toBeInTheDocument();
  await waitFor(() => expect(jobs).toEqual([['analyzeSleepLeft']]));
  expect(screen.queryByRole('button', { name: 'Analyze now' })).not.toBeInTheDocument();
});
it('keeps analysis disabled while the selected side is away', async () => {
  settings.left.awayMode = true;
  renderWithProviders(<SleepPage/>);
  expect(await screen.findByRole('button', { name: 'Analyze now' })).toBeDisabled();
  expect(jobs).toEqual([]);
});
it('shows a failed current analysis with a retry action', async () => {
  services.biometrics.jobs.analyzeSleepLeft.status = 'failed';
  services.biometrics.jobs.analyzeSleepLeft.timestamp = '2026-09-27T16:00:00Z';
  renderWithProviders(<SleepPage/>);
  expect(await screen.findByText("Couldn't analyze this night")).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
});
it('links disabled tracking to Features', async () => {
  services.biometrics.enabled = false;
  renderWithProviders(<SleepPage/>);
  expect(await screen.findByText('Sleep tracking is off')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Open Features settings' })).toHaveAttribute('href', '/settings/features');
});
it('keeps a measured zero distinct from a missing night', async () => {
  server.use(http.get('*/metrics/sleep', () => HttpResponse.json([{ ...older, sleep_period_seconds: 0 }])));
  const { user } = renderWithProviders(<SleepPage/>);
  await screen.findByText('No sleep detected');
  await user.click(screen.getByRole('button', { name: /Saturday, September 26/ }));
  expect(await screen.findByText('No sleep detected')).toBeInTheDocument();
  expect(screen.queryByText('Nothing recorded')).not.toBeInTheDocument();
});
it('shows the latest recorded night below a pending selected morning without changing the selection', async () => {
  server.use(http.get('*/metrics/sleep', () => HttpResponse.json([older])));
  const { user } = renderWithProviders(<SleepPage/>);
  await screen.findByRole('button', { name: /Saturday, September 26: recorded/ });
  await user.click(screen.getByRole('button', { name: /Sunday, September 27/ }));
  expect(screen.getByRole('button', { name: /Sunday, September 27/ })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByText('Not ready yet')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Woke Sat, Sep 26' })).toBeInTheDocument();
  expect(screen.getByLabelText('Night summary')).toBeInTheDocument();
});
it('does not apply a recent failed job to an explicitly chosen older empty night', async () => {
  services.biometrics.jobs.analyzeSleepLeft.status = 'failed';
  services.biometrics.jobs.analyzeSleepLeft.timestamp = '2026-09-27T16:00:00Z';
  const { user } = renderWithProviders(<SleepPage/>);
  await screen.findByText("Couldn't analyze this night");
  await user.click(screen.getByRole('button', { name: /Tuesday, September 22/ }));
  expect(screen.getByText('Nothing recorded')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
});
it('shows a failed request and permits retry without waiting for service status', async () => {
  server.use(http.post('*/jobs', () => HttpResponse.json({}, { status: 500 })));
  const { user } = renderWithProviders(<SleepPage/>);
  await user.click(await screen.findByRole('button', { name: 'Analyze now' }));
  expect(await screen.findByText("Couldn't analyze this night")).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
});
it('updates from analysis progress to new recorded results when the job completes', async () => {
  services.biometrics.jobs.analyzeSleepLeft.status = 'started';
  const { queryClient } = renderWithProviders(<SleepPage/>);
  expect(await screen.findByText('Analyzing last night')).toBeInTheDocument();
  services.biometrics.jobs.analyzeSleepLeft.status = 'healthy';
  services.biometrics.jobs.analyzeSleepLeft.timestamp = '2026-09-27T17:01:00Z';
  server.use(http.get('*/metrics/sleep', () => HttpResponse.json([{ ...older, left_bed_at: '2026-09-27T14:00:00Z' }])));
  await act(async () => {
    await queryClient.invalidateQueries({ queryKey: ['useServices'] });
    await queryClient.invalidateQueries({ queryKey: ['useSleepRecords'] });
  });
  expect(await screen.findByLabelText('Night summary')).toBeInTheDocument();
  expect(screen.queryByText('Analyzing last night')).not.toBeInTheDocument();
});


it.each(['waiting_for_data', 'healthy'] as const)('shows nothing recorded after today finished with %s', async status => {
  vi.mocked(moment.now).mockReturnValue(Date.parse('2026-09-28T01:00:00Z'));
  services.biometrics.jobs.analyzeSleepLeft.status = status;
  services.biometrics.jobs.analyzeSleepLeft.timestamp = '2026-09-27T19:02:00Z';
  renderWithProviders(<SleepPage/>);
  expect(await screen.findByText('Nothing recorded')).toBeInTheDocument();
  expect(screen.queryByText('Not ready yet')).not.toBeInTheDocument();
});
it('shows a failed afternoon analysis instead of a pending night', async () => {
  vi.mocked(moment.now).mockReturnValue(Date.parse('2026-09-28T01:00:00Z'));
  services.biometrics.jobs.analyzeSleepLeft.status = 'failed';
  services.biometrics.jobs.analyzeSleepLeft.timestamp = '2026-09-27T19:02:00Z';
  renderWithProviders(<SleepPage/>);
  expect(await screen.findByText("Couldn't analyze this night")).toBeInTheDocument();
  expect(screen.queryByText('Not ready yet')).not.toBeInTheDocument();
});
it('keeps yesterday missing-data result pending before today analysis time', async () => {
  services.biometrics.jobs.analyzeSleepLeft.status = 'waiting_for_data';
  renderWithProviders(<SleepPage/>);
  expect(await screen.findByText('Not ready yet')).toBeInTheDocument();
  expect(screen.getByText('Last night is analyzed at 12:00 PM.')).toBeInTheDocument();
});

it('selects the current wake date when showing pending analysis above an older record', async () => {
  server.use(http.get('*/metrics/sleep', () => HttpResponse.json([older])));
  renderWithProviders(<SleepPage/>);
  expect(await screen.findByText('Not ready yet')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Woke Sun, Sep 27' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Sunday, September 27/ })).toHaveAttribute('aria-pressed', 'true');
});

it.each(['waiting_for_data', 'healthy'] as const)('keeps today selected when analysis ends with %s and only older history', async status => {
  server.use(http.get('*/metrics/sleep', () => HttpResponse.json([older])));
  services.biometrics.jobs.analyzeSleepLeft.status = 'started';
  services.biometrics.jobs.analyzeSleepLeft.timestamp = '2026-09-27T19:00:00Z';
  const { queryClient } = renderWithProviders(<SleepPage/>);
  await screen.findByText('Analyzing last night');
  expect(screen.getByRole('button', { name: /Sunday, September 27/ })).toHaveAttribute('aria-pressed', 'true');
  services.biometrics.jobs.analyzeSleepLeft.status = status;
  services.biometrics.jobs.analyzeSleepLeft.timestamp = '2026-09-27T19:02:00Z';
  vi.mocked(moment.now).mockReturnValue(Date.parse('2026-09-28T01:00:00Z'));
  await act(() => queryClient.invalidateQueries({ queryKey: ['useServices'] }));
  expect(await screen.findByText('Nothing recorded')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Woke Sun, Sep 27' })).toBeInTheDocument();
  expect(screen.getByText('Most recent recording')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Woke Sat, Sep 26' })).toBeInTheDocument();
  expect(screen.getByLabelText('Night summary')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Sunday, September 27/ })).toHaveAttribute('aria-pressed', 'true');
});

it.each(['waiting_for_data', 'healthy'] as const)('opens today completed %s result instead of selecting an older recording', async status => {
  server.use(http.get('*/metrics/sleep', () => HttpResponse.json([older])));
  vi.mocked(moment.now).mockReturnValue(Date.parse('2026-09-28T01:00:00Z'));
  services.biometrics.jobs.analyzeSleepLeft.status = status;
  services.biometrics.jobs.analyzeSleepLeft.timestamp = '2026-09-27T19:02:00Z';
  const { user } = renderWithProviders(<SleepPage/>);
  await screen.findByRole('button', { name: /Saturday, September 26: recorded/ });
  expect(screen.getByText('Nothing recorded')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Woke Sun, Sep 27' })).toBeInTheDocument();
  expect(screen.getByText('Most recent recording')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Woke Sat, Sep 26' })).toBeInTheDocument();
  expect(screen.getByLabelText('Night summary')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Sunday, September 27/ })).toHaveAttribute('aria-pressed', 'true');
  await user.click(screen.getByRole('button', { name: /Saturday, September 26/ }));
  expect(await screen.findByLabelText('Night summary')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Woke Sat, Sep 26' })).toBeInTheDocument();
});

it('keeps an explicit older selection when today analysis completes without a recording', async () => {
  server.use(http.get('*/metrics/sleep', () => HttpResponse.json([older])));
  services.biometrics.jobs.analyzeSleepLeft.status = 'started';
  const { user, queryClient } = renderWithProviders(<SleepPage/>);
  await screen.findByText('Analyzing last night');
  await user.click(screen.getByRole('button', { name: /Saturday, September 26/ }));
  services.biometrics.jobs.analyzeSleepLeft.status = 'waiting_for_data';
  services.biometrics.jobs.analyzeSleepLeft.timestamp = '2026-09-27T19:02:00Z';
  await act(() => queryClient.invalidateQueries({ queryKey: ['useServices'] }));
  expect(screen.getByRole('button', { name: /Saturday, September 26/ })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByLabelText('Night summary')).toBeInTheDocument();
  expect(screen.queryByText('Nothing recorded')).not.toBeInTheDocument();
});


it('keeps the side tile aligned with the most recent displayed recording', async () => {
  settings.features.sleepScore = false;
  server.use(http.get('*/metrics/sleep', () => HttpResponse.json([older])));
  renderWithProviders(<SleepPage/>);
  await screen.findByText('Most recent recording');
  expect(screen.getAllByRole('radio', { name: /8h in bed/ })[0]).toBeChecked();
});

it('keeps the night summary when settings fail and explicitly labels the fallback timezone', async () => {
  server.use(
    http.get('*/settings', () => HttpResponse.json({}, { status: 500 })),
    http.get('*/metrics/sleep', () => HttpResponse.json([older])),
  );
  renderWithProviders(<SleepPage/>);
  expect(await screen.findByLabelText('Night summary')).toBeInTheDocument();
  expect(screen.getByText(/Pod settings could not be loaded/)).toBeInTheDocument();
  expect(screen.getByText(/Times shown in UTC/)).toBeInTheDocument();
});

it('shows service failure without losing the night summary', async () => {
  server.use(
    http.get('*/services', () => HttpResponse.json({}, { status: 500 })),
    http.get('*/metrics/sleep', () => HttpResponse.json([older])),
  );
  renderWithProviders(<SleepPage/>);
  expect(await screen.findByLabelText('Night summary')).toBeInTheDocument();
  expect(screen.getByText('Sleep tracking status could not be loaded.')).toBeInTheDocument();
});

it('shows measurement failures in collapsed vitals instead of no estimate', async () => {
  server.use(
    http.get('*/metrics/sleep', () => HttpResponse.json([older])),
    http.get('*/metrics/vitals', () => HttpResponse.json({}, { status: 500 })),
  );
  renderWithProviders(<SleepPage/>);
  await screen.findByLabelText('Night summary');
  expect(await screen.findAllByText('Measurements unavailable')).toHaveLength(1);
  expect(within(screen.getByRole('button', { name: /Heart rate/ })).queryByText('No estimate')).not.toBeInTheDocument();
});


it('uses the same longest session for the fallback summary and side tile', async () => {
  settings.features.sleepScore = false;
  server.use(http.get('*/metrics/sleep', () => HttpResponse.json([older, {
    ...older, id: 2, entered_bed_at: '2026-09-26T20:00:00Z', left_bed_at: '2026-09-26T21:00:00Z', sleep_period_seconds: 3600,
  }])));
  renderWithProviders(<SleepPage/>);
  await screen.findByText('Most recent recording');
  expect(within(screen.getByLabelText('Night summary')).getByText('8h')).toBeInTheDocument();
  expect(screen.getAllByRole('radio', { name: /8h in bed/ })[0]).toBeChecked();
});

it('shows failed stage data as an error while preserving the summary and vitals caveat', async () => {
  settings.features.sleepScore = true;
  services.biometrics.enabled = true;
  server.use(
    http.get('*/metrics/sleep', () => HttpResponse.json([older])),
    http.get('*/metrics/sleep-stages', () => HttpResponse.json({}, { status: 500 })),
  );
  renderWithProviders(<SleepPage/>);
  expect(await screen.findByText('Sleep stages could not be loaded.', {}, { timeout: 3000 })).toBeInTheDocument();
  expect(screen.getByLabelText('Night summary')).toBeInTheDocument();
  expect(screen.getByText('Estimates from bed sensors, not a medical measurement.')).toBeInTheDocument();
  expect(screen.queryByText('No sleep stages data available for this period')).not.toBeInTheDocument();
});
it('describes the Rhythms analysis timing only while Rhythms is active', async () => {
  settings.features.rhythms = true;
  resetMockRhythms(createDemoRhythms(), true);
  const active = renderWithProviders(<SleepPage/>);
  expect(await screen.findByText(RHYTHMS_PENDING_DESCRIPTION)).toBeInTheDocument();
  active.unmount();
  resetMockRhythms(null, true);
  renderWithProviders(<SleepPage/>);
  expect(await screen.findByText(/Last night is analyzed at/)).toBeInTheDocument();
  expect(screen.queryByText(RHYTHMS_PENDING_DESCRIPTION)).not.toBeInTheDocument();
});
