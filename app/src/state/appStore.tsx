import React, { useEffect } from 'react';
import { create } from 'zustand';
import moment from 'moment-timezone';

import { useSettings } from '@api/settings.ts';
import { useEventStream } from '@api/eventStream.ts';
import { resolvePinnedSide } from '@lib/compareMessages.ts';

export type Side = 'left' | 'right';

type AppState = {
  isUpdating: boolean;
  setIsUpdating: (isUpdating: boolean) => void;
  side: Side;
  setSide: (side: Side) => void;
  // True when the side came from a ?side= query param (a Compare-mode pane).
  // Pinned panes ignore side switches and hide the side toggle.
  sidePinned: boolean;
};

const SIDE_KEY = 'side';

// Read once at startup: the pin lasts for the lifetime of the document (the
// app is an SPA, so the search string never changes after load).
const PINNED_SIDE = resolvePinnedSide(window.location.search);

// Create Zustand store
export const useAppStore = create<AppState>((set) => ({
  isUpdating: false,
  setIsUpdating: (isUpdating: boolean) => set({ isUpdating }),
  side: PINNED_SIDE ?? (localStorage.getItem(SIDE_KEY) as Side || 'left'),
  sidePinned: PINNED_SIDE !== null,
  setSide: (side: Side) => {
    // A pinned pane exists to show one fixed side; also don't let it clobber
    // the side preference of the full (non-pinned) app in localStorage.
    if (PINNED_SIDE !== null) return;
    set({ side });
    localStorage.setItem(SIDE_KEY, side);
  },
}));

// AppStoreProvider to sync Zustand with react-query's isFetching
export function AppStoreProvider({ children }: React.PropsWithChildren) {
  // One WebSocket for the whole app, pushing device-status/service-health
  // updates straight into the React Query cache. Mounted at the tree root so
  // there's no per-page connection churn.
  useEventStream();
  const { data: settings } = useSettings();

  useEffect(() => {
    if (!settings) return;
    moment.tz.setDefault(settings.timeZone);
  }, [settings]);

  return <>{ children }</>;
}
