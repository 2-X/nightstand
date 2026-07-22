import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import ChangelogPage from './ChangelogPage';

describe('ChangelogPage', () => {
  it('renders the changelog page', async () => {
    renderWithProviders(<ChangelogPage />, { initialRoute: '/changelog' });
    expect(await screen.findByText('Changelog')).toBeInTheDocument();
  });
});
