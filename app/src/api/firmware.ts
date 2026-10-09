import { useQuery } from '@tanstack/react-query';
import axios from './api';
import type { FirmwareTelemetry } from '../../../server/src/firmware/firmwareTelemetry';
export type FirmwareSnapshot = ReturnType<FirmwareTelemetry['snapshot']>;

export function useFirmware(enabled: boolean) {
  return useQuery<FirmwareSnapshot>({
    queryKey: ['firmware'], enabled, refetchInterval: 15_000,
    queryFn: async ({ signal }) => (await axios.get<FirmwareSnapshot>('/services/firmware', { signal })).data,
  });
}
