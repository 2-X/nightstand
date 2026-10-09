import { getDeviceStatus } from '../mocks/mockData';
import { expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '@test/renderWithProviders';
import { server } from '@test/setup';
import VersionStatus from './VersionStatus';
import UpdateFreeSleepButton from '../pages/SettingsPage/DeviceSettingsSection/UpdateFreeSleepButton';

const manifest = { channels: ['stable', 'beta'], releases: [
  { kind: 'agent', version: '3.2.0', channel: 'stable', date: '2026-09-20' },
  { kind: 'agent', version: '3.4.0', channel: 'beta', date: '2026-09-28' },
] };
for (const running of ['3.1.0', '3.2.0', '3.3.0']) {
  it(`offers only a newer channel release when running ${running}`, async () => {
    server.use(
      http.get('*/deviceStatus',
        () => HttpResponse.json({ ...getDeviceStatus(),
          freeSleep: { ...getDeviceStatus().freeSleep,
            version: running } })),
      http.get('https://raw.githubusercontent.com/LTimothy/nightstand/main/releases.json', () => HttpResponse.json(manifest)),
    );
    renderWithProviders(<VersionStatus/>);
    if (running === '3.1.0') {
      expect(await screen.findByRole('button', { name: 'Update to v3.2.0' })).toBeEnabled();
      expect(await screen.findByText('Latest version: 3.2.0')).toBeInTheDocument();
      expect(await screen.findByText('Current version: 3.1.0')).toBeInTheDocument();
    } else {
      expect(await screen.findByText('Up to date')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Update to v3.2.0' })).not.toBeInTheDocument();
    }
  });
}
for (const running of ['3.2.0', '3.3.0']) {
  it(`prevents direct update to a release no newer than ${running}`, async () => {
    server.use(http.get('https://raw.githubusercontent.com/LTimothy/nightstand/main/releases.json', () => HttpResponse.json(manifest)));
    renderWithProviders(<UpdateFreeSleepButton runningVersion={ running }/>);
    const button = await screen.findByRole('button', { name: 'Update to v3.2.0' });
    await waitFor(() => expect(button).toBeDisabled());
  });
}
