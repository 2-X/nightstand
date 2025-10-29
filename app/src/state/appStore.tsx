import React, { useEffect } from 'react';
import { create } from 'zustand';
import { useIsFetching } from '@tanstack/react-query';
import moment from 'moment-timezone';
import { useSettings } from '@api/settings.ts';
import { useServices } from '@api/services.ts';
import { closeSentry, initSentryTags } from '../sentry.ts';
import { useDeviceStatus } from '@api/deviceStatus.ts';

export type Side = 'left' | 'right';

type AppState = {
  isUpdating: boolean;
  setIsUpdating: (isUpdating: boolean) => void;
  side: Side;
  setSide: (side: Side) => void;
};

const SIDE_KEY = 'side';
export const USER_ID_KEY = 'user_id';
export const HUB_VERSION_KEY = 'pod_version';
export const COVER_VERSION_KEY = 'cover_version';

// Create Zustand store
export const useAppStore = create<AppState>((set) => ({
  isUpdating: false,
  setIsUpdating: (isUpdating: boolean) => set({ isUpdating }),
  side: localStorage.getItem(SIDE_KEY) as Side || 'left',
  setSide: (side: Side) => {
    set({ side });
    localStorage.setItem(SIDE_KEY, side);
  },
}));

// AppStoreProvider to sync Zustand with react-query's isFetching
export function AppStoreProvider({ children }: React.PropsWithChildren) {
  const { data: settings } = useSettings();
  const { data: services } = useServices();
  const { data: deviceStatus } = useDeviceStatus();

  const isFetching = useIsFetching({
    // @ts-expect-error
    predicate: (query) => query?.options?.method !== 'GET',
  }) > 0;

  useEffect(() => {
    if (!settings) return;
    // @ts-ignore
    moment.tz.setDefault(settings.timeZone);
  }, [settings]);

  useEffect(() => {
    if (!settings || !deviceStatus || !services) return;
    localStorage.setItem(USER_ID_KEY, settings.id);
    localStorage.setItem(HUB_VERSION_KEY, deviceStatus.hubVersion);
    localStorage.setItem(COVER_VERSION_KEY, deviceStatus.coverVersion);

    if (services.sentryLogging) {
      initSentryTags(settings, deviceStatus);
    } else {
      closeSentry();
    }
  }, [settings, deviceStatus, services]);

  // Directly update the store's state
  useEffect(() => {
    useAppStore.setState({ isUpdating: isFetching });
  }, [isFetching]);

  return <>{ children }</>;
}
