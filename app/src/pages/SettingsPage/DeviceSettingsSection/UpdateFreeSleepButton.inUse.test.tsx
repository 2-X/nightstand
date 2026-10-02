import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { act, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import { server } from '@test/setup';
import { SIDE_ON, serveInUse } from '@test/inUse';
import UpdateFreeSleepButton from './UpdateFreeSleepButton';

const manifest = { channels: ['stable', 'beta'], releases: [{ kind: 'agent', version: '3.2.0', channel: 'stable', date: '2026-09-20' }] };
const OPEN = { name: /^Update(?: to.*)?$/ };
const IDLE = 'Nightstand restarts to finish, and schedules and alarms pause for up to five minutes.';
const TIMED_OUT = 'Until this page loads again, schedules and alarms are not running.';

beforeEach(() => {
  server.use(http.get('https://raw.githubusercontent.com/LTimothy/nightstand/main/releases.json', () => HttpResponse.json(manifest)));
});
afterEach(() => vi.useRealTimers());

const openDialog = async () => {
  const view = renderWithProviders(<UpdateFreeSleepButton runningVersion="3.0.0"/>);
  await waitFor(() => expect(screen.getByRole('button', OPEN)).toBeEnabled());
  await view.user.click(screen.getByRole('button', OPEN));
  return view;
};

describe('UpdateFreeSleepButton when the bed may be in use', () => {
  it('says Nightstand, not the Pod, restarts', async () => {
    await openDialog();
    expect(await screen.findByText(IDLE)).toBeInTheDocument();
    expect(screen.getByRole('dialog')).not.toHaveTextContent(/Pod restarts/);
  });

  it('asks again after a refusal and confirms the same request on Continue anyway', async () => {
    const bodies = serveInUse('*/update', ['left-on']);
    const { user } = await openDialog();
    await user.click(await screen.findByRole('button', { name: 'Update now' }));
    expect(await screen.findByText(SIDE_ON)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Update now' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Continue anyway' }));
    await waitFor(() => expect(bodies).toEqual([{ targetVersion: '3.2.0' }, { targetVersion: '3.2.0', confirmInUse: true }]));
  });

  it('sends no confirmation when the bed is idle', async () => {
    const bodies = serveInUse('*/update', []);
    const { user } = await openDialog();
    await user.click(await screen.findByRole('button', { name: 'Update now' }));
    await waitFor(() => expect(bodies).toEqual([{ targetVersion: '3.2.0' }]));
  });

  it('says schedules and alarms are not running once it times out', async () => {
    serveInUse('*/update', []);
    server.use(http.get('*/deviceStatus', () => HttpResponse.json({}, { status: 503 })));
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { user } = await openDialog();
    await user.click(await screen.findByRole('button', { name: 'Update now' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60 * 1000 + 10_000); });
    expect(screen.getByRole('dialog', { name: 'Still not done' })).toHaveTextContent(TIMED_OUT);
  });
});
