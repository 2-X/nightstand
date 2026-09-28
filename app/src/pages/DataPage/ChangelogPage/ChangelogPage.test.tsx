import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import { http, HttpResponse } from 'msw';
import { server } from '@test/setup';
import ChangelogPage from './ChangelogPage';

describe('ChangelogPage', () => {
  it('renders the changelog page', async () => {
    renderWithProviders(<ChangelogPage />, { initialRoute: '/changelog' });
    expect(await screen.findByText('Changelog')).toBeInTheDocument();
  });
});

it('keeps detailed release notes collapsed until the release is expanded', async () => {
  const { user } = renderWithProviders(<ChangelogPage />);
  const rows = await screen.findAllByRole('button', { name: /^v\d/ });
  expect(rows[0]).toHaveAttribute('aria-expanded', 'false');
  await user.click(rows[0]);
  expect(rows[0]).toHaveAttribute('aria-expanded', 'true');
});

it('opens the exact release linked from the software screen', async () => {
  server.use(http.get('*/changelog', () => HttpResponse.json({ entries: [
    { version: '3.4.0', date: '2026-09-28', body: 'Specific release details.' },
  ] })));
  renderWithProviders(<ChangelogPage />, { initialRoute: '/changelog#release-v3.4.0' });
  expect(await screen.findByRole('button', { name: /^v3.4.0/ })).toHaveAttribute('aria-expanded', 'true');
});
