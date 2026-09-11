import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import VitalsSummaryCard from './VitalsSummaryCard';

vi.mock('@api/vitals.ts', () => ({
  useVitalsSummary: () => ({ data: {
    avgHeartRate: null, minHeartRate: null, maxHeartRate: null, avgHRV: null, avgBreathingRate: null,
  }, isFetching: false }),
}));

describe('unavailable vitals', () => {
  it('shows missing readings instead of physiological zeros and names the HRV measure', () => {
    renderWithProviders(<VitalsSummaryCard startTime="2026-09-10T00:00:00Z" endTime="2026-09-11T00:00:00Z" />);
    expect(screen.getByText('HRV (SDNN)')).toBeInTheDocument();
    expect(screen.getAllByText('—')).toHaveLength(5);
    expect(screen.queryByText('bpm')).not.toBeInTheDocument();
  });
});
