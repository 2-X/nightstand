import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import serverInfo from '../../../server/src/serverInfo.json';
import semver from 'semver';

export type ServerInfo = {
  version: string;
  branch: string;
  updateAvailable: boolean;
}

type LatestVersion = {
  version: string;
  branch: string;
}

// The newest build published on this fork's main, which is what the pod's
// updater installs. Fetched raw from GitHub, same reasoning as releases.ts:
// the pod has no WAN, so this only ever resolves from the browser.
export const getLatestVersion = async (signal?: AbortSignal) => {
  return axios.get<LatestVersion>(
    'https://raw.githubusercontent.com/LTimothy/nightstand/main/server/src/serverInfo.json',
    { signal }
  );
};


export const useServerInfo = () => useQuery<ServerInfo>({
  queryKey: ['useServerInfo'],
  queryFn: async ({ signal }) => {
    const response = await getLatestVersion(signal);
    let updateAvailable = semver.gt(response.data.version, serverInfo.version);
    if (import.meta.env.VITE_ENV === 'demo') {
      updateAvailable = true;
    }
    return {
      ...response.data,
      updateAvailable
    };
  },
  staleTime: 60_000,
});

