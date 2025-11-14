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

export const getLatestVersion = async () => {
  return axios.get<LatestVersion>(
    'https://raw.githubusercontent.com/throwaway31265/free-sleep/main/server/src/serverInfo.json'
  );
};


export const useServerInfo = () => useQuery<ServerInfo>({
  queryKey: ['useServerInfo'],
  queryFn: async () => {
    const response = await getLatestVersion();

    return {
      ...response.data,
      updateAvailable: semver.gt(response.data.version, serverInfo.version),
    };
  },
  staleTime: 60_000,
});

