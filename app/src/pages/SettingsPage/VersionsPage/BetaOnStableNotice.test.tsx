import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import { server } from '@test/setup';
import type { Release } from '@api/releases';
import BetaOnStableNotice, { runningBetaOnStable } from './BetaOnStableNotice';

const releases: Release[] = [
  { kind: 'bundle', version: '3.5.1', channel: 'beta', date: '2026-10-01', upstreamBase: '2.1.5', features: [] },
  { kind: 'bundle', version: '3.3.2', channel: 'stable', date: '2026-09-29', upstreamBase: '2.1.5', features: [] },
];

describe('runningBetaOnStable', () => {
  it('is true only for a beta build on the stable channel', () => {
    expect(runningBetaOnStable('3.5.1', releases, 'stable')).toBe(true);
    expect(runningBetaOnStable('3.5.1', releases, undefined)).toBe(true);
    expect(runningBetaOnStable('3.5.1', releases, 'beta')).toBe(false);
    expect(runningBetaOnStable('3.3.2', releases, 'stable')).toBe(false);
    expect(runningBetaOnStable('9.9.9', releases, 'stable')).toBe(false);
    expect(runningBetaOnStable(undefined, releases, 'stable')).toBe(false);
    expect(runningBetaOnStable('3.5.1', undefined, 'stable')).toBe(false);
  });
});

describe('BetaOnStableNotice', () => {
  it('explains the situation and switches the channel to beta', async () => {
    let posted: unknown;
    server.use(http.post('*/settings', async ({ request }) => {
      posted = await request.json();
      return HttpResponse.json({});
    }));
    const { user } = renderWithProviders(<BetaOnStableNotice running="3.5.1" releases={ releases } saved="stable"/>);
    expect(screen.getByText(
      'You are running v3.5.1, a beta release. Your update channel is Stable, ' +
      'so updates appear once a stable release is newer than this one.'
    )).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Switch to Beta' }));
    await waitFor(() => expect(posted).toEqual({ updateChannel: 'beta' }));
  });

  it('keeps a 44 px target on the switch button', () => {
    renderWithProviders(<BetaOnStableNotice running="3.5.1" releases={ releases } saved="stable"/>);
    expect(screen.getByRole('button', { name: 'Switch to Beta' })).toHaveStyle({ minHeight: '44px' });
  });

  it('renders nothing on the beta channel', () => {
    renderWithProviders(<BetaOnStableNotice running="3.5.1" releases={ releases } saved="beta"/>);
    expect(screen.queryByRole('button', { name: 'Switch to Beta' })).not.toBeInTheDocument();
  });

  it('reports a failed switch once, keeps the button usable, and clears the line on the next press', async () => {
    let fail = true;
    server.use(http.post('*/settings', () => fail ? new HttpResponse(null, { status: 500 }) : new Promise(() => undefined)));
    const { user } = renderWithProviders(<BetaOnStableNotice running="3.5.1" releases={ releases } saved="stable"/>);
    await user.click(screen.getByRole('button', { name: 'Switch to Beta' }));
    const line = await screen.findByText('Could not save the update channel. Try again.');
    expect(screen.getAllByRole('alert')).toEqual([line]);
    expect(screen.getByRole('button', { name: 'Switch to Beta' })).toBeEnabled();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Switch to Beta' }));
    await waitFor(() => expect(screen.queryByText('Could not save the update channel. Try again.')).not.toBeInTheDocument());
  });

  it('tells the caller when the switch is saved', async () => {
    server.use(http.post('*/settings', () => HttpResponse.json({})));
    let switched = 0;
    const { user } = renderWithProviders(
      <BetaOnStableNotice running="3.5.1" releases={ releases } saved="stable" onSwitched={ () => { switched += 1; } }/>);
    await user.click(screen.getByRole('button', { name: 'Switch to Beta' }));
    await waitFor(() => expect(switched).toBe(1));
  });
});
