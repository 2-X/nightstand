import { expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import ReleaseRow from './ReleaseRow';
import RevertToStockRow from './RevertToStockRow';

it('explains downgrade behavior before installation', async () => {
  const release = { kind: 'bundle', version: '3.2.2', upstreamBase: '2.1.5', channel: 'stable', date: '2026-01-01', features: [] } as const;
  const { user } = renderWithProviders(<ReleaseRow release={ { ...release, features: [] } } runningVersion="3.5.0" body={ undefined }/>);
  await user.click(screen.getByRole('button', { name: 'Install (downgrade)' }));
  expect(screen.getByText(/Presence auto-off cannot be switched off/)).toBeInTheDocument();
  expect(screen.getByText(/36 hours/)).toBeInTheDocument();
  expect(screen.getByText(/older firewall/)).toBeInTheDocument();
  expect(screen.getByText(/Rhythms and pause/)).toBeInTheDocument();
});

it('names backups, retained components, and upstream recovery hazards', async () => {
  const { user } = renderWithProviders(<RevertToStockRow runningVersion="3.4.0"/>);
  await user.click(screen.getByRole('button', { name: 'Switch to upstream free-sleep' }));
  expect(screen.getByText(/free-sleep-database-backups/)).toBeInTheDocument();
  expect(screen.getByText(/Do not follow/)).toBeInTheDocument();
  expect(screen.getByText(/Tailscale/)).toBeInTheDocument();
  expect(screen.getByText(/sudoers/)).toBeInTheDocument();
  expect(screen.getByText(/first enabled alarm/)).toBeInTheDocument();
});
