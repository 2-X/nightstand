import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { z } from 'zod';
import currentServerInfo from '../../../server/src/serverInfo.json';
import { UPDATE_CHANNELS, UpdateChannelType } from './settingsSchema.ts';

const releaseFields = {
  version: z.string(),
  channel: z.enum(UPDATE_CHANNELS),
  date: z.string(),
  artifacts: z.record(z.string(), z.string()).optional(),
};

// The agent overlays whatever stock a pod already runs and replaces no
// upstream code, so it has no base of its own. A bundle is the full tree
// built against exactly one upstream release, so it names that base and the
// features it carries.
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
  releases: z.array(ReleaseSchema),
});

export type Release = z.infer<typeof ReleaseSchema>;
export type ReleasesManifest = z.infer<typeof ReleasesManifestSchema>;

// Fetched raw from GitHub, same reasoning as serverInfo.ts and the remote
// changelog fetch: the pod itself has no WAN, so this only ever resolves
// from the browser. Failure is non-fatal: callers fall back to the plain
// serverInfo.json "latest main" comparison.
const RELEASES_URL = 'https://raw.githubusercontent.com/LTimothy/nightstand/main/releases.json';

const CHANNEL_RANK: Record<UpdateChannelType, number> = { stable: 0, beta: 1 };

export const useReleases = () => useQuery<ReleasesManifest>({
  queryKey: ['useReleases'],
  queryFn: async () => {
    const response = await axios.get<ReleasesManifest>(RELEASES_URL);
    return ReleasesManifestSchema.parse(response.data);
  },
  staleTime: 60_000,
  retry: false,
});

// Newest release visible on `channel`. releases.json is expected newest
// first, and beta sees every release while stable only sees releases
// promoted to stable. Undefined when the manifest hasn't loaded.
export const latestForChannel = (
  manifest: ReleasesManifest | undefined,
  channel: UpdateChannelType
): Release | undefined => {
  if (!manifest) return undefined;
  const rank = CHANNEL_RANK[channel];
  return manifest.releases.find(release => CHANNEL_RANK[release.channel] <= rank);
};

// The upstream release this build was made from, baked in at build time.
export const podUpstreamBase = (): string => currentServerInfo.upstreamBase;

// A bundle swaps the whole tree, so installing one built against a different
// upstream release silently changes the upstream code underneath while the
// stock snapshot still restores the original. Surface that; do not block it.
export const baseMismatch = (release: Release, installedBase: string | undefined): boolean => {
  if (release.kind !== 'bundle') return false;
  if (installedBase === undefined) return false;
  return release.upstreamBase !== installedBase;
};
