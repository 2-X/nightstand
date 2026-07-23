import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import { server } from '@test/setup';
import ControlTempPage from './ControlTempPage';

describe('ControlTempPage malformed deviceStatus robustness', () => {
  it('does not crash when deviceStatus is missing the selected side', async () => {
    server.use(
      http.get('*/api/deviceStatus', () => HttpResponse.json({
        // 'left' (the default selected side) is absent entirely.
        right: {
          currentTemperatureLevel: 5,
          currentTemperatureF: 85,
          targetTemperatureF: 86,
          secondsRemaining: 1560,
          isOn: true,
          isAlarmVibrating: false,
        },
        waterLevel: 'true',
        isPriming: false,
        settings: { v: 12, gainLeft: 3, gainRight: 4, ledBrightness: 60 },
        coverVersion: 'Pod 5',
        hubVersion: 'Pod 5',
        freeSleep: { version: '2.1.5', branch: 'main' },
        wifiStrength: 82,
        sensorTemps: null,
      })),
    );

    renderWithProviders(<ControlTempPage />, { initialRoute: '/' });
    expect(await screen.findByText('Temperature')).toBeInTheDocument();
    // Missing side data means isOn defaults to false rather than throwing.
    expect(await screen.findByText('Off')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Turn on' })).toBeInTheDocument();
  });
});
