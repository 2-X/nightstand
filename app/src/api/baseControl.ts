import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import axiosInstance from './api';

// Schemas
const BaseStatusSchema = z.object({
  head: z.number(),
  feet: z.number(),
  isMoving: z.boolean(),
  lastUpdate: z.string(),
  isConfigured: z.boolean().optional(),
});

const BasePositionSchema = z.object({
  head: z.number(),
  feet: z.number(),
  feedRate: z.number().optional(),
});

export type BaseStatus = z.infer<typeof BaseStatusSchema>;
export type BaseStatusUI = Pick<
  BaseStatus,
  'head' | 'feet' | 'isMoving' | 'isConfigured'
>;
export type BasePosition = z.infer<typeof BasePositionSchema>;

// API functions
const getBaseStatus = async (signal?: AbortSignal): Promise<BaseStatus> => {
  const response = await axiosInstance.get('/base-control', { signal });
  return BaseStatusSchema.parse(response.data);
};

const setBasePosition = async (position: BasePosition) => {
  const response = await axiosInstance.post('/base-control', BasePositionSchema.parse(position));
  return response.data;
};

const setBasePreset = async (preset: 'flat' | 'sleep' | 'relax' | 'read') => {
  const response = await axiosInstance.post('/base-control/preset', {
    preset,
  });
  return response.data;
};

const stopBase = async () => {
  const response = await axiosInstance.post('/base-control/stop');
  return response.data;
};

// React Query hooks
export const useBaseStatus = () => {
  return useQuery({
    queryKey: ['baseStatus'],
    queryFn: ({ signal }) => getBaseStatus(signal),
    refetchInterval: 2000, // Refetch every 2 seconds to track movement
    select: (data) => ({
      // Only include fields that matter for UI state, exclude lastUpdate to prevent unnecessary re-renders
      head: data.head,
      feet: data.feet,
      isMoving: data.isMoving,
      isConfigured: data.isConfigured,
    }),
  });
};

// One-shot "is there an adjustable base at all?" check, used to decide whether
// the Elevation tab should exist. Deliberately separate from useBaseStatus so
// merely rendering the navbar doesn't start a 2s poll of the base endpoint.
// Configured-ness only changes with a service restart, so cache it for the
// lifetime of the page.
export const useBaseConfigured = (): boolean => {
  const { data } = useQuery({
    queryKey: ['baseConfigured'],
    queryFn: ({ signal }) => getBaseStatus(signal),
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
    retry: 1,
  });
  return data?.isConfigured === true;
};

export const useSetBasePosition = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: setBasePosition,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['baseStatus'] });
    },
  });
};

export const useSetBasePreset = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: setBasePreset,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['baseStatus'] });
    },
  });
};

export const useStopBase = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: stopBase,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['baseStatus'] });
    },
  });
};
