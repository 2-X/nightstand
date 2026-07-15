import { useQuery } from '@tanstack/react-query';
import podAxios from './api';
import axios from 'axios';
import semver from 'semver';
import { parseChangelog } from '../../../server/src/routes/changelog/changelogParser.ts';
import { ChangelogEntry, ChangelogResponse } from './changelogSchema.ts';

// Two sources for changelog entries, same shape either way:
//
//   1. The pod's own /api/changelog, which parses the CHANGELOG.md sitting in
//      the running install. Always available offline, always matches what's
//      actually installed. This is the full-history source for the
//      Changelog page.
//   2. Raw CHANGELOG.md fetched from GitHub (same pattern as
//      serverInfo.ts: the pod has no WAN, so this only ever resolves from
//      the browser). Used to find entries *newer* than the running version
//      for the update alert's "what's new", and to prepend
//      not-yet-installed entries on the Changelog page. Failure here is
//      non-fatal: the alert/page just shows versions without prose.
const RAW_CHANGELOG_URL = 'https://raw.githubusercontent.com/LTimothy/nightstand/main/CHANGELOG.md';

export const useChangelog = () => useQuery<ChangelogEntry[]>({
  queryKey: ['useChangelog'],
  queryFn: async () => {
    const response = await podAxios.get<ChangelogResponse>('/changelog');
    return response.data.entries;
  },
  staleTime: 60_000,
});

export const useRemoteChangelog = () => useQuery<ChangelogEntry[]>({
  queryKey: ['useRemoteChangelog'],
  queryFn: async () => {
    const response = await axios.get<string>(RAW_CHANGELOG_URL, { responseType: 'text' });
    return parseChangelog(response.data);
  },
  staleTime: 60_000,
  retry: false,
});

// Entries from `remoteEntries` whose version is newer than `runningVersion`:
// the "what's new since you installed" list for the update alert.
export const entriesNewerThan = (
  remoteEntries: ChangelogEntry[] | undefined,
  runningVersion: string | undefined
): ChangelogEntry[] => {
  if (!remoteEntries || !runningVersion || !semver.valid(runningVersion)) return [];
  return remoteEntries.filter(entry => semver.valid(entry.version) && semver.gt(entry.version, runningVersion));
};
