import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import { http, HttpResponse } from 'msw';
import { server } from '@test/setup';
import VersionsPage from './VersionsPage';

describe('VersionsPage', () => {
  it('renders the versions page', async () => {
    renderWithProviders(<VersionsPage />, { initialRoute: '/settings/versions' });
    expect(await screen.findByText('Software & updates')).toBeInTheDocument();
  });
});

it('shows a failed channel save and retains the saved channel', async () => {
  server.use(http.post('*/settings', () => new HttpResponse(null, { status: 500 })));
  const { user } = renderWithProviders(<VersionsPage />);
  await user.click(await screen.findByRole('button', { name: 'beta' }));
  expect(await screen.findByText(/Could not save the update channel/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'stable' })).toHaveAttribute('aria-pressed', 'true');
});
