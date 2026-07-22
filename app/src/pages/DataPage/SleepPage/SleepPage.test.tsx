import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import SleepPage from './SleepPage';

describe('SleepPage', () => {
  it('renders the sleep page', async () => {
    renderWithProviders(<SleepPage />, { initialRoute: '/data/sleep' });
    expect(await screen.findByText('Sleep')).toBeInTheDocument();
  });
});
