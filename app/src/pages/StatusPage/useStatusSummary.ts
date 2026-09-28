import { useEffect, useState } from 'react';
import { useServerStatus } from '@api/serverStatus';
import { coreServicesReady, needsAttention, overdueCoreKeys, usableStatusKeys } from './statusMeta';

export function useStatusSummary() {
  const query = useServerStatus(30_000);
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick(tick => tick + 1), 10_000);
    return () => clearInterval(timer);
  }, []);
  const { data, clock } = query;
  const keys = usableStatusKeys(data);
  const podNow = clock ? clock.podTime + Math.max(0, performance.now() - clock.receivedAt) : undefined;
  const overdue = overdueCoreKeys(data, podNow);
  const attention = keys.filter(key => needsAttention(data?.[key]?.status) || overdue.includes(key));
  return { ...query, keys, overdue, attention, coreReady: coreServicesReady(data), now: Date.now() };
}
