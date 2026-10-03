import { useEffect, useState } from 'react';
import { useDeviceStatus } from '@api/deviceStatus';
import type { Side } from '@state/appStore';
import { REFRESH_GRACE_MS, STALE_AFTER_MS, bedFrame } from './bedFrame';

// The one reading of whether the device status is live, shared by Bed, the side tiles and the Smart Schedule line so
// they cannot disagree.
export function useDeviceFreshness() {
  const query = useDeviceStatus();
  // A failure another page already saw dates from then. Read once, so later failures do not move it forward.
  const [requestedAt] = useState(() => Math.min(Date.now(), query.errorUpdatedAt || Infinity));
  // A refresh the browser holds back while offline waits like one under way, so its grace runs out the same way.
  const asking = query.isFetching || query.isPaused;
  const [refreshStartedAt, setRefreshStartedAt] = useState<number>();
  if (asking && refreshStartedAt === undefined) setRefreshStartedAt(Date.now());
  if (!asking && refreshStartedAt !== undefined) setRefreshStartedAt(undefined);
  const [ticks, tick] = useState(0);
  const { data, dataUpdatedAt, isError, refetch } = query;
  const old = !!data && Date.now() - dataUpdatedAt > STALE_AFTER_MS;
  // An old status with nothing asking for a new one, as when the app comes back from the background: ask now.
  useEffect(() => {
    if (old && !asking && !isError) void refetch({ cancelRefetch: false });
  }, [old, asking, isError, refetch]);
  // Render again when the last status turns two minutes old and when a refresh's grace ends, even if nothing else
  // changes.
  useEffect(() => {
    if (!data) return;
    const due = [dataUpdatedAt + STALE_AFTER_MS, refreshStartedAt === undefined ? -1 : refreshStartedAt + REFRESH_GRACE_MS]
      .map(at => at - Date.now()).filter(ms => ms >= 0);
    if (!due.length) return;
    const timer = setTimeout(() => tick(value => value + 1), Math.min(...due) + 1);
    return () => clearTimeout(timer);
  }, [data, dataUpdatedAt, refreshStartedAt, ticks]);
  const frameFor = (side: Side) => bedFrame({
    status: data?.[side],
    hasData: !!data,
    // A first load that failed stays failed while it is asked again, so the frame does not fall back to loading.
    isError: isError || (!data && query.errorUpdateCount > 0),
    refreshStartedAt,
    failureCount: query.failureCount,
    dataUpdatedAt,
    requestedAt,
    now: Date.now(),
  });
  return { ...query, frameFor };
}
