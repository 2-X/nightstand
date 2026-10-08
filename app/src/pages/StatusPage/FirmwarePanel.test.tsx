import { screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { renderWithProviders } from '@test/renderWithProviders';
import FirmwareReadout from './FirmwareReadout';
import type { FirmwareSnapshot } from '@api/firmware';

const cooling = { state: 'unavailable', active: false, notice: false, message: '', since: undefined };
function snapshot(availability: string, sensorFresh: boolean, targets: FirmwareSnapshot['targets']): FirmwareSnapshot {
  return { availability, sensorFresh, targets, interrupted: false, incidents: [], taps: [], cooling: { left: cooling, right: cooling } };
}

it('shows an independent firmware target to a tenth in Fahrenheit', () => {
  renderWithProviders(<FirmwareReadout
    data={ snapshot('Monitoring active', true, {
      left: { state: 'available', targetC: 25.08 }, right: { state: 'disabled', targetC: 25 },
    }) }
    format="fahrenheit"
  />);
  expect(screen.getByText('Left firmware target: 77.1°F')).toBeInTheDocument();
  expect(screen.getByText('Right firmware target: Disabled')).toBeInTheDocument();
});
it('distinguishes stale, unavailable and monitoring off', () => {
  renderWithProviders(<FirmwareReadout
    data={ snapshot('Monitoring unavailable', false, {
      left: { state: 'stale', targetC: 25 }, right: { state: 'unavailable' },
    }) }
    format="celsius"
  />);
  expect(screen.getByText('Monitoring unavailable')).toBeInTheDocument();
  expect(screen.getByText('Left firmware target: 25.0°C (stale)')).toBeInTheDocument();
  expect(screen.getByText('Right firmware target: Unavailable')).toBeInTheDocument();
});
