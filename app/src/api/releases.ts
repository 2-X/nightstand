import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import semver from 'semver';
import { z } from 'zod';
import currentServerInfo from '../../../server/src/serverInfo.json';
// Keep the release manifest independent of the full device-settings schema:
// the small updater overlay also runs against upstream settings.
const RELEASE_CHANNELS = ['stable', 'beta'] as const;

const releaseFields = {
  version: z.string(),
  channel: z.enum(RELEASE_CHANNELS),
  date: z.string(),
  artifacts: z.record(z.string(), z.string()).optional(),
  // Digest of the release tree, which the updater checks a download against.
  treeSha256: z.string().optional(),
};

// Every release is a bundle: the full tree built against one upstream
// release, naming that base and the features it carries. 'agent' is an older
// kind no release uses anymore; it stays accepted so the manifest keeps
// parsing if one ever appears.
const AgentReleaseSchema = z.object({ kind: z.literal('agent'), ...releaseFields });
const BundleReleaseSchema = z.object({
  kind: z.literal('bundle'),
  ...releaseFields,
  upstreamBase: z.string(),
  features: z.array(z.string()),
});

const ReleaseSchema = z.discriminatedUnion('kind', [AgentReleaseSchema, BundleReleaseSchema]);

export const ReleasesManifestSchema = z.object({
  channels: z.array(z.string()),
  releases: z.array(z.unknown()).transform(entries => entries.filter(entry => {
    // Future release kinds are irrelevant to this client; malformed known
    // kinds must still fail validation rather than becoming install targets.
    return !(entry && typeof entry === 'object' && 'kind' in entry
      && typeof entry.kind === 'string' && !['agent', 'bundle'].includes(entry.kind));
  })).pipe(z.array(ReleaseSchema)),
  // The upstream commit "Switch to upstream" installs, recorded once the
  // switch has been checked with it. A malformed record is dropped rather
  // than taking the release list down with it.
  upstreamSwitch: z.object({ commit: z.string(), date: z.string(), treeSha256: z.string().optional() })
    .optional().catch(undefined),
});

export type Release = z.infer<typeof ReleaseSchema>;
export type ReleasesManifest = z.infer<typeof ReleasesManifestSchema>;

// Fetched raw from GitHub, same reasoning as serverInfo.ts and the remote
// changelog fetch: the pod itself has no WAN, so this only ever resolves
// from the browser. Without it, callers cannot offer a channel-safe target.
const RELEASES_URL = 'https://raw.githubusercontent.com/LTimothy/nightstand/main/releases.json';

const CHANNEL_RANK: Record<typeof RELEASE_CHANNELS[number], number> = { stable: 0, beta: 1 };

export const useReleases = () => useQuery<ReleasesManifest>({
  queryKey: ['useReleases'],
  queryFn: async ({ signal }) => {
    const response = await axios.get<ReleasesManifest>(RELEASES_URL, {
      signal, responseType: 'json', transitional: { silentJSONParsing: false },
    });
    return ReleasesManifestSchema.parse(response.data);
  },
  staleTime: 60_000,
  retry: false,
});

// Both the update target and the picker use the same channel eligibility.
export const releasesForChannel = (
  manifest: ReleasesManifest | undefined,
  channel: typeof RELEASE_CHANNELS[number]
): Release[] => (manifest?.releases ?? [])
  .filter(release => semver.valid(release.version) && CHANNEL_RANK[release.channel] <= CHANNEL_RANK[channel]
    && (channel === 'beta' || semver.prerelease(release.version) === null))
  .sort((left, right) => semver.rcompare(left.version, right.version));

export const latestForChannel = (
  manifest: ReleasesManifest | undefined,
  channel: typeof RELEASE_CHANNELS[number]
): Release | undefined => releasesForChannel(manifest, channel)[0];

// The upstream release this build was made from, baked in at build time.
export const podUpstreamBase = (): string => currentServerInfo.upstreamBase;

// A bundle swaps the whole tree, so installing one built against a different
// upstream release silently changes the upstream code underneath. Surface
// that; do not block it. Note reverting to stock does not undo it: there is
// no snapshot of the tree a pod started from, only a download of the upstream
// commit the switch was checked with (or main, before one is recorded), so
// the base a pod lands back on is not guaranteed to be the one it left.
export const baseMismatch = (release: Release, installedBase: string | undefined): boolean => {
  if (release.kind !== 'bundle') return false;
  if (installedBase === undefined) return false;
  return release.upstreamBase !== installedBase;
};
