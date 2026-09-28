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
      http.get('*/deviceStatus', () => HttpResponse.json({ freeSleep: { version: running } })),
      http.get('https://raw.githubusercontent.com/LTimothy/nightstand/main/releases.json', () => HttpResponse.json(manifest)),
    );
    const { queryClient } = renderWithProviders(<VersionStatus/>);
    await waitFor(() => expect(queryClient.getQueryData(['useReleases'])).toEqual(manifest));
    if (running === '3.1.0') {
      expect(await screen.findByRole('button', { name: 'Update to 3.2.0' })).toBeEnabled();
      expect(screen.getByText('Latest version: 3.2.0')).toBeInTheDocument();
      expect(screen.getByText('Current version: 3.1.0')).toBeInTheDocument();
    } else {
      expect(screen.queryByRole('button', { name: 'Update to 3.2.0' })).not.toBeInTheDocument();
    }
  });
}
for (const running of ['3.2.0', '3.3.0']) {
  it(`prevents direct update to a release no newer than ${running}`, async () => {
    server.use(http.get('https://raw.githubusercontent.com/LTimothy/nightstand/main/releases.json', () => HttpResponse.json(manifest)));
    const { queryClient } = renderWithProviders(<UpdateFreeSleepButton runningVersion={ running }/>);
    await waitFor(() => expect(queryClient.getQueryData(['useReleases'])).toEqual(manifest));
    expect(screen.getByRole('button', { name: 'Update to 3.2.0' })).toBeDisabled();
  });
}
