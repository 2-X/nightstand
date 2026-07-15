import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { z } from 'zod';
import { UPDATE_CHANNELS, UpdateChannelType } from './settingsSchema.ts';

const ReleaseSchema = z.object({
  version: z.string(),
  channel: z.enum(UPDATE_CHANNELS),
  date: z.string(),
  artifacts: z.record(z.string(), z.string()).optional(),
});

const ReleasesManifestSchema = z.object({
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
