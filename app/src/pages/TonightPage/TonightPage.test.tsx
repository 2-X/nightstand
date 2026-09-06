import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import TonightPage from './TonightPage';

describe('TonightPage', () => {
  it('renders the header and the alarm list from the mocks', async () => {
    renderWithProviders(<TonightPage />, { initialRoute: '/' });
    expect(await screen.findByText('Tonight', {}, { timeout: 5000 })).toBeInTheDocument();
    // The "water temp" legend label from the display-honesty annotation.
    expect(await screen.findByText('water temp', {}, { timeout: 5000 })).toBeInTheDocument();
    // Left side (default) has a weekdays 07:00 alarm in the mocks; its cadence
    // chip should appear in the alarm list once /api/alarms resolves.
    expect(await screen.findByText('Mon–Fri', {}, { timeout: 5000 })).toBeInTheDocument();
  });
});
