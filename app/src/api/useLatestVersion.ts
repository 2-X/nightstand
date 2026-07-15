import { useSettings } from './settings.ts';
import { useServerInfo } from './serverInfo.ts';
import { useReleases, latestForChannel } from './releases.ts';

// The one "what's the latest build for this user" answer, shared by the
// update alert, the Update button's dialog, and the Versions page: newest
// releases.json entry on the user's channel (beta sees everything, stable
// only sees promoted releases), falling back to the plain serverInfo.json
// "latest main" version when releases.json hasn't loaded or failed to fetch.
export const useLatestVersion = (): string | undefined => {
  const { data: settings } = useSettings();
  const { data: releases } = useReleases();
  const { data: serverInfo } = useServerInfo();
  const channel = settings?.updateChannel ?? 'stable';
  return latestForChannel(releases, channel)?.version ?? serverInfo?.version;
};
