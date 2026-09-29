import axios from './api';
import { useQuery } from '@tanstack/react-query';
import { DeepPartial } from 'ts-essentials';
import { Schedules, SchedulesUpdateSchema } from '@api/schedulesSchema.ts';


export const useSchedules = () => useQuery<Schedules>({
  queryKey: ['useSchedules'],
  queryFn: async ({ signal }) => {
    const response = await axios.get<Schedules>('/schedules', { signal });
    return response.data;
  },
});


export const postSchedules = async (schedules: DeepPartial<Schedules>) => {
  return axios.post('/schedules', SchedulesUpdateSchema.parse(schedules));
};



