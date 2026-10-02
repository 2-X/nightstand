import { describe, it, expect } from 'vitest';
import {
  ReleasesManifestSchema,
  latestForChannel,
  baseMismatch,
  podUpstreamBase,
  type Release,
  type ReleasesManifest,
} from './releases.ts';

const agent: Release = { kind: 'agent', version: '3.0.0', channel: 'stable', date: '2026-07-16' };
const bundle: Release = {
  kind: 'bundle',
  version: '3.1.0',
  channel: 'beta',
  date: '2026-07-20',
  upstreamBase: '2.1.5',
  features: ['biometrics'],
};

describe('ReleasesManifestSchema', () => {
  it('parses an agent release, which carries no base or features', () => {
    const parsed = ReleasesManifestSchema.parse({ channels: ['stable', 'beta'], releases: [agent] });
    expect(parsed.releases[0]).toEqual(agent);
  });

  it('parses a bundle release with its base and features', () => {
    const parsed = ReleasesManifestSchema.parse({ channels: ['stable', 'beta'], releases: [bundle] });
    expect(parsed.releases[0]).toEqual(bundle);
  });

  it('rejects a bundle with no upstreamBase, since a bundle is built against exactly one', () => {
    const bad = { channels: ['stable'], releases: [{ ...bundle, upstreamBase: undefined }] };
    expect(() => ReleasesManifestSchema.parse(bad)).toThrow();
  });

  it('rejects a bundle with no features, since a bundle must declare what it carries', () => {
    const bad = { channels: ['stable'], releases: [{ ...bundle, features: undefined }] };
    expect(() => ReleasesManifestSchema.parse(bad)).toThrow();
  });

  it('keeps a release\'s published tree checksum, which older releases do not have', () => {
    const withDigest = { ...bundle, treeSha256: 'a'.repeat(64) };
    const parsed = ReleasesManifestSchema.parse({ channels: ['stable'], releases: [withDigest, agent] });
    expect(parsed.releases).toEqual([withDigest, agent]);
  });

  it('reads the upstream commit the switch was checked with, when one is recorded', () => {
    const upstreamSwitch = { commit: 'b'.repeat(40), date: '2026-10-02', treeSha256: 'c'.repeat(64) };
    expect(ReleasesManifestSchema.parse({ channels: ['stable'], releases: [], upstreamSwitch }).upstreamSwitch)
      .toEqual(upstreamSwitch);
    expect(ReleasesManifestSchema.parse({ channels: ['stable'], releases: [] }).upstreamSwitch).toBeUndefined();
  });

  it('drops a malformed upstream switch record rather than the whole manifest', () => {
    const parsed = ReleasesManifestSchema.parse({ channels: ['stable'], releases: [bundle], upstreamSwitch: { commit: 1 } });
    expect(parsed.upstreamSwitch).toBeUndefined();
    expect(parsed.releases).toEqual([bundle]);
  });

  it('skips an unknown kind without losing known releases', () => {
    const bad = { channels: ['stable'], releases: [{ ...agent, kind: 'overlay' }, bundle] };
    expect(ReleasesManifestSchema.parse(bad).releases).toEqual([bundle]);
  });
});

describe('latestForChannel', () => {
  const manifest: ReleasesManifest = { channels: ['stable', 'beta'], releases: [bundle, agent] };

  it('shows a stable user only promoted releases, regardless of kind', () => {
    expect(latestForChannel(manifest, 'stable')?.version).toBe('3.0.0');
  });

  it('shows a beta user the newest release of any kind', () => {
    expect(latestForChannel(manifest, 'beta')?.version).toBe('3.1.0');
  });

  it('sorts valid releases and excludes prereleases from stable', () => {
    const mixed: ReleasesManifest = { channels: ['stable', 'beta'], releases: [
      { ...agent, version: 'latest' }, agent, { ...agent, version: '4.0.0-rc.1' }, { ...agent, version: '3.5.0' },
    ] };
    expect(latestForChannel(mixed, 'stable')?.version).toBe('3.5.0');
    expect(latestForChannel(mixed, 'beta')?.version).toBe('4.0.0-rc.1');
  });

  it('returns undefined when the manifest has not loaded', () => {
    expect(latestForChannel(undefined, 'stable')).toBeUndefined();
  });
});

describe('baseMismatch', () => {
  it('never flags an agent release, which overlays whatever stock is present', () => {
    expect(baseMismatch(agent, '2.0.1')).toBe(false);
  });

  it('does not flag a bundle built on the same base as the installed build', () => {
    expect(baseMismatch(bundle, '2.1.5')).toBe(false);
  });

  it('flags a bundle built on a different base, which would change the upstream code underneath', () => {
    expect(baseMismatch(bundle, '2.0.1')).toBe(true);
  });

  it('does not flag anything when the installed base is unknown, rather than warning on a guess', () => {
    expect(baseMismatch(bundle, undefined)).toBe(false);
  });
});

describe('podUpstreamBase', () => {
  // Guards the field itself: this fails if serverInfo.json ever loses
  // upstreamBase, which the docs promise readers exists.
  it('reports the upstream base baked into this build', () => {
    expect(podUpstreamBase()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
