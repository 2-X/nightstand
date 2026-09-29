import { describe, it, expect } from 'vitest';
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
