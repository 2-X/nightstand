import axios from './api';
import { useQuery } from '@tanstack/react-query';
import { DeepPartial } from 'ts-essentials';
import { DeviceStatus } from './deviceStatusSchema';


export const getDeviceStatus = async (signal?: AbortSignal) => {
  return axios.get<DeviceStatus>('/deviceStatus', { signal });
};

// Real-time updates flow over the WebSocket (see api/eventStream.ts); the
// 60s refetchInterval is just a safety net for clients that lost their socket
// connection and haven't reconnected yet.
export const useDeviceStatus = () => useQuery<DeviceStatus>({
  queryKey: ['useDeviceStatus'],
  queryFn: async ({ signal }) => {
    const response = await getDeviceStatus(signal);
    return response.data;
  },
  refetchInterval: 60_000,
});


export const postDeviceStatus = async (deviceStatus: DeepPartial<DeviceStatus>) => {
  for (const side of ['left', 'right'] as const) {
    const target = deviceStatus[side]?.targetTemperatureF;
    if (target !== undefined && (!Number.isFinite(target) || target < 55 || target > 110)) {
      throw new Error('Invalid target temperature.');
    }
  }
  return axios.post('/deviceStatus', deviceStatus);
};



