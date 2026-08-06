import axios from './api';
import { useQuery } from '@tanstack/react-query';
import { DeepPartial } from 'ts-essentials';
import { Settings } from './settingsSchema';


export const useSettings = () => useQuery<Settings>({
  queryKey: ['useSettings'],
  queryFn: async ({ signal }) => {
    const response = await axios.get<Settings>('/settings', { signal });
    return response.data;
  },
});


export const postSettings = (deviceStatus: DeepPartial<Settings>) => {
  return axios.post('/settings', deviceStatus);
};



