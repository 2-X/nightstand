import { expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import { postJobs } from '@api/jobs.ts';
import RebootButton from './RebootButton';
vi.mock('@api/jobs.ts', () => ({ postJobs: vi.fn() }));

it('names the restart, explains interruption and reports acceptance without claiming completion', async () => {
  vi.mocked(postJobs).mockResolvedValue({} as never);
  const { user } = renderWithProviders(<RebootButton/>);
  await user.click(screen.getByRole('button', { name: 'Restart Pod' }));
  const dialog = screen.getByRole('dialog', { name: 'Restart Pod?' });
  expect(dialog).toHaveTextContent('schedules and alarms pause');
  await user.click(within(dialog).getByRole('button', { name: 'Restart Pod' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Restart requested');
});

it('shows restart failures and keeps the dialog dismissible', async () => {
  vi.mocked(postJobs).mockRejectedValue(new Error('offline'));
  const { user } = renderWithProviders(<RebootButton/>);
  await user.click(screen.getByRole('button', { name: 'Restart Pod' }));
  const dialog = screen.getByRole('dialog', { name: 'Restart Pod?' });
  await user.click(within(dialog).getByRole('button', { name: 'Restart Pod' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not confirm');
  expect(within(dialog).getByRole('link', { name: 'System status' })).toHaveAttribute('href', '/settings/system');
  expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeEnabled();
});
