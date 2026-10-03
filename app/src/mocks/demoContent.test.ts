import { afterEach, describe, expect, it } from 'vitest';
import serverInfo from '../../../server/src/serverInfo.json';
import releases from '../../../releases.json';
import { parseChangelog } from '../../../server/src/routes/changelog/changelogParser.ts';
import { DEMO_UPDATE_KEY } from './demoPreferences';
import { getChangelog, getReleasesManifest, getRemoteChangelogMarkdown, getSettings } from './mockData';

afterEach(() => localStorage.removeItem(DEMO_UPDATE_KEY));

describe('demo version story', () => {
  it('lists real releases, newest first, including the running one', () => {
    const versions = getReleasesManifest().releases.map(release => release.version);
    expect(versions).toContain(serverInfo.version);
    expect(versions.indexOf(serverInfo.version)).toBeLessThanOrEqual(1);
  });
  it('shows release notes from CHANGELOG.md, newest first', () => {
    const entries = getChangelog();
    expect(entries[0].version).toBe(releases.releases[0].version);
    expect(entries.map(entry => entry.date)).toEqual([...entries.map(entry => entry.date)].sort().reverse());
  });
  it('puts the sample release ahead of the real notes when the demo offers one', () => {
    localStorage.setItem(DEMO_UPDATE_KEY, 'on');
    const [sample, next] = parseChangelog(getRemoteChangelogMarkdown());
    expect(sample.version).toBe(getReleasesManifest().releases[0].version);
    expect(sample.body).toBe('Sample release offered by the demo.');
    expect(next.version).toBe(releases.releases[0].version);
  });
  it('saves the channel the running version was released on', () => {
    const running = releases.releases.find(release => release.version === serverInfo.version);
    expect(getSettings().updateChannel).toBe(running?.channel ?? 'stable');
  });
});
