import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import CalibrationSubline from './CalibrationSubline';

const calibrated = {
  state: 'calibrated' as const,
  summary: 'Learned from a 22 min empty-bed window.',
  quality: 0.8,
  calibratedAt: 1_700_001_400,
  lastRunStatus: 'success',
};

describe('CalibrationSubline', () => {
  it('shows the window the profile was learned from', async () => {
    renderWithProviders(<CalibrationSubline view={ calibrated }/>);
    expect(await screen.findByText(/22 min empty-bed window/)).toBeInTheDocument();
  });

  it('says nothing alarming when the pod has never calibrated', async () => {
    renderWithProviders(
      <CalibrationSubline
        view={ {
          state: 'none', summary: 'Not calibrated yet. This happens automatically once the sensors record a stretch of empty bed.',
          quality: null, calibratedAt: null, lastRunStatus: null,
        } }/>,
    );
    expect(await screen.findByText(/Not calibrated yet/)).toBeInTheDocument();
    expect(screen.queryByText(/low confidence/i)).not.toBeInTheDocument();
  });

  it('marks a thin calibration as low confidence without calling it a failure', async () => {
    renderWithProviders(<CalibrationSubline view={ { ...calibrated, quality: 0.2 } }/>);
    expect(await screen.findByText(/low confidence/i)).toBeInTheDocument();
  });

  it('does not call a carried-over profile low confidence', async () => {
    renderWithProviders(
      <CalibrationSubline
        view={ {
          state: 'imported', summary: 'Carried over from an earlier version, confidence unknown.',
          quality: null, calibratedAt: 1_700_001_400, lastRunStatus: 'success',
        } }/>,
    );
    expect(await screen.findByText(/confidence unknown/)).toBeInTheDocument();
    expect(screen.queryByText(/low confidence/i)).not.toBeInTheDocument();
  });

  it('renders nothing when there is no calibration data for this row', () => {
    const { container } = renderWithProviders(<CalibrationSubline view={ undefined }/>);
    expect(container).toBeEmptyDOMElement();
  });
});
