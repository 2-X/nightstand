import { useSettings } from './settings.ts';
import { useReleases, latestForChannel } from './releases.ts';

// The one "what's the latest build for this user" answer, shared by the
// update alert, the Update button's dialog, and the Versions page: newest
// releases.json entry on the user's channel (beta sees everything, stable
// only sees promoted releases). Without a manifest, no target is known.
export const useLatestVersion = (): string | undefined => {
  const { data: settings } = useSettings();
  const { data: releases } = useReleases();
  // Upstream installs using the updater overlay predate this preference.
  const channel = (settings as { updateChannel?: 'stable' | 'beta' } | undefined)?.updateChannel ?? 'stable';
  return latestForChannel(releases, channel)?.version;
};
