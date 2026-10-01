import { expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import { DEFAULT_SMART } from '@api/rhythmsSchema';
import SmartScheduleControls from './SmartScheduleControls';

it('changes intensity, switches and the base level', async () => {
  const onChange = vi.fn();
  const { user } = renderWithProviders(<SmartScheduleControls
    value={ DEFAULT_SMART }
    onChange={ onChange }
    format="level"
    trackingOn
    daySleep={ false }
    disabled={ false }/>);
  await user.click(screen.getByRole('button', { name: 'Gentle' }));
  expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SMART, intensity: 'gentle' });
  await user.click(screen.getByRole('switch', { name: 'Warm start' }));
  expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SMART, warmStart: false });
  await user.click(screen.getByRole('button', { name: 'Increase base temperature' }));
  expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SMART, baseLevel: 1 });
  expect(screen.getByRole('switch', { name: 'Skip the warm-up if I get up early' })).toBeEnabled();
  expect(screen.getByText(/Off for a sleep that is mostly during the day or shorter than 3 hours/)).toBeInTheDocument();
});

it('needs Biometrics for up early and explains day sleep', () => {
  renderWithProviders(<SmartScheduleControls
    value={ DEFAULT_SMART }
    onChange={ () => {} }
    format="level"
    trackingOn={ false }
    daySleep
    disabled={ false }/>);
  expect(screen.getByRole('switch', { name: 'Skip the warm-up if I get up early' })).toBeDisabled();
  expect(screen.getByText('Needs Biometrics.')).toBeInTheDocument();
  expect(screen.getByRole('note')).toHaveTextContent(/mostly during the day/);
  expect(screen.getByRole('switch', { name: 'Warm start' })).toBeDisabled();
  expect(screen.queryByText("Starts cooling once you've settled in bed")).not.toBeInTheDocument();
});
