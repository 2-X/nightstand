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

  it('rejects an unknown kind', () => {
    const bad = { channels: ['stable'], releases: [{ ...agent, kind: 'overlay' }] };
    expect(() => ReleasesManifestSchema.parse(bad)).toThrow();
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

  it('returns undefined when the manifest has not loaded', () => {
    expect(latestForChannel(undefined, 'stable')).toBeUndefined();
  });
});

describe('baseMismatch', () => {
  it('never flags an agent release, which overlays whatever stock is present', () => {
    expect(baseMismatch(agent, '2.0.1')).toBe(false);
  });

  it('does not flag a bundle built on the base this pod already runs', () => {
    expect(baseMismatch(bundle, '2.1.5')).toBe(false);
  });

  it('flags a bundle built on a different base, which would change the upstream code underneath', () => {
    expect(baseMismatch(bundle, '2.0.1')).toBe(true);
  });

  it('does not flag anything when the pod base is unknown, rather than warning on a guess', () => {
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
