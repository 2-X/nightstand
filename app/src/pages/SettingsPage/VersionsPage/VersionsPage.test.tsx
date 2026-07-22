import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import VersionsPage from './VersionsPage';

describe('VersionsPage', () => {
  it('renders the versions page', async () => {
    renderWithProviders(<VersionsPage />, { initialRoute: '/settings/versions' });
    expect(await screen.findByText('Software & updates')).toBeInTheDocument();
  });
});
