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


export const postDeviceStatus = (deviceStatus: DeepPartial<DeviceStatus>) => {
  return axios.post('/deviceStatus', deviceStatus);
};



