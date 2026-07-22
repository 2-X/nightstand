import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import VitalsPage from './VitalsPage';

describe('VitalsPage', () => {
  // VitalsPage is an intentional empty stub kept as scaffolding.
  it('renders the vitals page header', async () => {
    renderWithProviders(<VitalsPage />, { initialRoute: '/data/vitals' });
    expect(await screen.findByText('Vitals')).toBeInTheDocument();
  });
});
