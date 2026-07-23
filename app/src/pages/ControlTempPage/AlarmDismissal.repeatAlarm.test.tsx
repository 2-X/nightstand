import { describe, it, expect, beforeEach } from 'vitest';
import { act } from 'react';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import { useControlTempStore } from './controlTempStore.tsx';
import type { DeviceStatus } from '@api/deviceStatusSchema.ts';
import AlarmDismissal from './AlarmDismissal.tsx';

function makeStatus(alarmVibrating: boolean): DeviceStatus {
  const side = {
    currentTemperatureLevel: 0,
    currentTemperatureF: 82,
    targetTemperatureF: 84,
    secondsRemaining: 0,
    isOn: true,
    isAlarmVibrating: alarmVibrating,
  };
  return {
    left: { ...side, isAlarmVibrating: alarmVibrating },
    right: { ...side },
    waterLevel: 'good',
    isPriming: false,
    settings: { v: 1, gainLeft: 1, gainRight: 1, ledBrightness: 1 },
    coverVersion: '1',
    hubVersion: '1',
    freeSleep: { version: '3.0.0', branch: 'main' },
    wifiStrength: -50,
    sensorTemps: null,
  } as DeviceStatus;
}

// A second alarm on the same mounted page should prompt the dismissal dialog
// again. The pod re-raises isAlarmVibrating for every alarm; the UI must react
// each time, not just the first.
describe('AlarmDismissal repeat alarm', () => {
  beforeEach(() => {
    useControlTempStore.setState({ deviceStatus: makeStatus(true), pendingEdits: 0 });
  });

  it('re-opens the dismissal dialog when a new alarm fires after a prior dismissal', async () => {
    renderWithProviders(<AlarmDismissal refetch={ () => Promise.resolve() } />);

    // First alarm: dialog is open.
    const dismissBtn = await screen.findByRole('button', { name: /dismiss alarm/i });

    // Dismiss it (POST succeeds via default handler).
    await act(async () => {
      dismissBtn.click();
    });

    // The dialog closes once the dismiss actually succeeds. Note isAlarmVibrating
    // is STILL true here (the refetch mock does not clear it), so the only thing
    // that can close the dialog is the component's internal `dismissed` flag.
    await waitFor(
      () => expect(screen.queryByRole('button', { name: /dismiss alarm/i })).not.toBeInTheDocument(),
      { timeout: 3000 },
    );

    // The pod stops vibrating, then a brand-new alarm fires later the next night,
    // on the same still-mounted page.
    await act(async () => {
      useControlTempStore.setState({ deviceStatus: makeStatus(false) });
    });
    await act(async () => {
      useControlTempStore.setState({ deviceStatus: makeStatus(true) });
    });

    // The dialog must prompt the user again.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /dismiss alarm/i })).toBeInTheDocument(),
    );
  });
});
