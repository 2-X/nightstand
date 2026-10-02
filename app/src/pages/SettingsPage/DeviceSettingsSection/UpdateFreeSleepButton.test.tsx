import { afterEach, describe, it, expect, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { act, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import { server } from '@test/setup';
import UpdateFreeSleepButton from './UpdateFreeSleepButton';

const manifestUrl = 'https://raw.githubusercontent.com/LTimothy/nightstand/main/releases.json';
const manifest = { channels: ['stable', 'beta'], releases: [
  { kind: 'agent', version: '3.3.0', channel: 'beta', date: '2026-09-28' },
  { kind: 'agent', version: '3.2.0', channel: 'stable', date: '2026-09-20' },
] };
describe('UpdateFreeSleepButton', () => {
  it('shows and submits the same channel-eligible target', async () => {
    let posted: unknown;
    server.use(http.get(manifestUrl, () => HttpResponse.json(manifest)));
    server.use(
      http.post('*/update', async ({ request }) => {
        posted = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const { user } = renderWithProviders(<UpdateFreeSleepButton runningVersion="3.0.0"/>);
    expect(screen.queryByText('Update to vundefined?')).not.toBeInTheDocument();

    await waitFor(() => expect(screen.getByRole('button', { name: /^Update(?: to.*)?$/ })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: /^Update(?: to.*)?$/ }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(await screen.findByText('Update to v3.2.0?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Update now' }));

    await waitFor(() => expect(posted).toEqual({ targetVersion: '3.2.0' }));
  });

  it('closes the dialog on Cancel and fires no job', async () => {
    server.use(http.get(manifestUrl, () => HttpResponse.json(manifest)));
    let jobbed = false;
    server.use(
      http.post('*/update', () => {
        jobbed = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const { user } = renderWithProviders(<UpdateFreeSleepButton runningVersion="3.0.0"/>);

    await waitFor(() => expect(screen.getByRole('button', { name: /^Update(?: to.*)?$/ })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: /^Update(?: to.*)?$/ }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(jobbed).toBe(false);
  });
});

it('does not offer a branch-tip update when the release manifest is unavailable', async () => {
  server.use(http.get(manifestUrl, () => new HttpResponse(null, { status: 503 })));
  renderWithProviders(<UpdateFreeSleepButton runningVersion="3.0.0"/>);
  await waitFor(() => expect(screen.getByRole('button', { name: /^Update(?: to.*)?$/ })).toBeDisabled());
});
it('shows a rejected request and lets the user close the dialog', async () => {
  server.use(http.get(manifestUrl, () => HttpResponse.json(manifest)),
    http.post('*/update', () => HttpResponse.json({ error: 'Update refused' }, { status: 400 })));
  const { user } = renderWithProviders(<UpdateFreeSleepButton runningVersion="3.0.0"/>);
  await waitFor(() => expect(screen.getByRole('button', { name: /^Update(?: to.*)?$/ })).toBeEnabled());
  await waitFor(() => expect(screen.getByRole('button', { name: /^Update(?: to.*)?$/ })).toBeEnabled());
  await user.click(screen.getByRole('button', { name: /^Update(?: to.*)?$/ }));
  await user.click(screen.getByRole('button', { name: 'Update now' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Update refused');
  await user.click(screen.getByRole('button', { name: 'Close' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

it('keeps the confirmed target when the manifest refreshes while the dialog is open', async () => {
  let posted: unknown;
  server.use(http.get(manifestUrl, () => HttpResponse.json(manifest)),
    http.post('*/update', async ({ request }) => { posted = await request.json(); return new HttpResponse(null, { status: 204 }); }));
  const { user, queryClient } = renderWithProviders(<UpdateFreeSleepButton runningVersion="3.0.0"/>);
  await waitFor(() => expect(screen.getByRole('button', { name: /^Update(?: to.*)?$/ })).toBeEnabled());
  await user.click(screen.getByRole('button', { name: /^Update(?: to.*)?$/ }));
  await act(async () => { queryClient.setQueryData(['useReleases'], { ...manifest, releases: [
    { kind: 'agent', version: '3.4.0', channel: 'stable', date: '2026-09-29' }, ...manifest.releases,
  ] }); });
  expect(screen.getByText('Update to v3.2.0?')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Update now' }));
  await waitFor(() => expect(posted).toEqual({ targetVersion: '3.2.0' }));
});

describe('when the update records how it ended', () => {
  afterEach(() => vi.useRealTimers());

  const run = async (outcome: string, message: string) => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let reads = 0;
    const record = (runId: string) => ({ runId, operation: 'update', outcome, from: '3.0.0', to: '3.2.0', message,
      finishedAt: reads === 0 ? '2026-10-02T03:00:00Z' : '2026-10-02T03:04:05Z' });
    server.use(
      http.get(manifestUrl, () => HttpResponse.json(manifest)),
      http.post('*/update', () => new HttpResponse(null, { status: 204 })),
      http.get('*/update/last-result', () => HttpResponse.json(record(reads++ === 0 ? 'old' : 'new'))),
    );
    const problems: unknown[][] = [];
    const { user } = renderWithProviders(
      <UpdateFreeSleepButton runningVersion="3.0.0" onProblem={ (...args) => problems.push(args) }/>,
    );
    await waitFor(() => expect(screen.getByRole('button', { name: /^Update(?: to.*)?$/ })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: /^Update(?: to.*)?$/ }));
    await user.click(screen.getByRole('button', { name: 'Update now' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(5_100); });
    return { alert: await screen.findByRole('alert'), problems };
  };

  it.each(['stopped', 'rolled-back'])('shows the reason for a %s update and leaves no notice behind', async (outcome) => {
    const { alert, problems } = await run(outcome, 'low disk on /persistent (50M free, 173M needed)');
    expect(alert).toHaveTextContent('low disk on /persistent (50M free, 173M needed)');
    expect(alert).not.toHaveTextContent('did not accept the update request');
    expect(screen.getByText('Update did not finish')).toBeVisible();
    expect(problems).toEqual([]);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible();
  });

  it('reports a failed update as unfinished and does not offer to try again', async () => {
    const { alert, problems } = await run('failed', 'x');
    expect(alert).toHaveTextContent('Open the update log and System status before trying again.');
    expect(alert).not.toHaveTextContent('did not accept the update request');
    expect(problems).toEqual([['timed_out', '3.0.0']]);
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });
});
