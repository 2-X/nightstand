import { afterEach, expect, it } from 'vitest';
import semver from 'semver';
import serverInfo from '../../../server/src/serverInfo.json';
import { latestForChannel, ReleasesManifestSchema } from '@api/releases.ts';
import { DEMO_UPDATE_KEY } from './demoPreferences';
import { getDeviceStatus, getReleasesManifest, getRemoteChangelogMarkdown, getRemoteServerInfo } from './mockData';

afterEach(() => localStorage.removeItem(DEMO_UPDATE_KEY));

const latest = () => latestForChannel(ReleasesManifestSchema.parse(getReleasesManifest()), 'stable')?.version;

it('runs this checkout\'s version and reports itself up to date', () => {
  expect(getDeviceStatus().freeSleep.version).toBe(serverInfo.version);
  expect(getRemoteServerInfo().version).toBe(serverInfo.version);
  expect(semver.gt(latest() ?? '0.0.0', serverInfo.version)).toBe(false);
  expect(getRemoteChangelogMarkdown()).not.toMatch(/Sample release/);
});

it('offers a sample newer release only when the demo is set to', () => {
  localStorage.setItem(DEMO_UPDATE_KEY, 'on');
  const version = latest();
  expect(version && semver.gt(version, serverInfo.version)).toBe(true);
  expect(getRemoteServerInfo().version).toBe(version);
});
