import { useEffect, useState } from 'react';
import { useDeviceStatus } from '@api/deviceStatus';
import { useAppStore } from '@state/appStore';
import { STALE_AFTER_MS, bedFrame } from './bedFrame';

// The Bed page's one reading of the device status: the query, plus whether its answer is live.
export function useBedFrame() {
  const query = useDeviceStatus();
  const { side } = useAppStore();
  const [requestedAt] = useState(() => Date.now());
  const [, tick] = useState(0);
  const { data, dataUpdatedAt } = query;
  // Render again the moment the last status turns two minutes old, even if nothing else changes.
  useEffect(() => {
    if (!data) return;
    const timer = setTimeout(() => tick(value => value + 1), Math.max(0, dataUpdatedAt + STALE_AFTER_MS - Date.now()) + 1);
    return () => clearTimeout(timer);
  }, [data, dataUpdatedAt]);
  const frame = bedFrame({
    status: data?.[side],
    hasData: !!data,
    // A first load that failed stays failed while it is asked again, so the frame does not fall back to loading.
    isError: query.isError || (!data && query.errorUpdateCount > 0),
    isFetching: query.isFetching,
    failureCount: query.failureCount,
    dataUpdatedAt,
    requestedAt,
    now: Date.now(),
  });
  return { ...query, frame };
}
