import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import VitalsPage from './VitalsPage';

describe('VitalsPage', () => {
  it('renders the vitals page header', async () => {
    renderWithProviders(<VitalsPage />, { initialRoute: '/data/vitals' });
    expect(await screen.findByText('Vitals')).toBeInTheDocument();
  });

  it('shows a live snapshot card per side, named from settings', async () => {
    renderWithProviders(<VitalsPage />, { initialRoute: '/data/vitals' });
    // Mock settings name the sides "Left side" / "Right side"; each appears
    // twice - once on the person card and once as a chart legend stat.
    const leftLabels = await screen.findAllByText('Left side');
    const rightLabels = await screen.findAllByText('Right side');
    expect(leftLabels.length).toBeGreaterThanOrEqual(1);
    expect(rightLabels.length).toBeGreaterThanOrEqual(1);
  });

  it('renders an overlay chart card per metric', async () => {
    renderWithProviders(<VitalsPage />, { initialRoute: '/data/vitals' });
    expect(await screen.findByText('HEART RATE')).toBeInTheDocument();
    // "HRV" also appears as a row label on each person card, so match >= 1.
    expect(screen.getAllByText('HRV').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('BREATHING RATE')).toBeInTheDocument();
    expect(screen.getByText('BED TEMPERATURE')).toBeInTheDocument();
  });

  it('offers lookback window options', async () => {
    renderWithProviders(<VitalsPage />, { initialRoute: '/data/vitals' });
    expect(await screen.findByText('3h')).toBeInTheDocument();
    expect(screen.getByText('12h')).toBeInTheDocument();
    expect(screen.getByText('24h')).toBeInTheDocument();
  });
});
