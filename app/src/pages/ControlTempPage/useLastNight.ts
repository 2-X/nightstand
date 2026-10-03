import { useMemo } from 'react';
import moment from 'moment-timezone';

import { useAppStore } from '@state/appStore.tsx';
import { useSleepRecords } from '@api/sleep.ts';
import { useSleepScore, useSleepScoreEnabled } from '@api/sleepScore.ts';
import { useSettings } from '@api/settings.ts';
import { recordForNight } from '../DataPage/SleepPage/sleepContext.ts';

export type LastNight = {
  score: number;
  // The score's own duration line, such as "7h 12m in bed".
  duration?: string;
};

// The selected side's last night's sleep estimate, or undefined while loading, when
// there is no night, or when sleep score is off.
export function useLastNight(): LastNight | undefined {
  const { side } = useAppStore();
  const sleepScoreEnabled = useSleepScoreEnabled();
  const { data: settings } = useSettings();
  // Unset means UTC, as on the Sleep page; wait only while settings load.
  const timeZone = settings ? settings.timeZone ?? 'UTC' : undefined;

  // Fetch the most recent sleep record from the last 36 hours. Computed once
  // per mount, not on every render: useSleepRecords keys its query on this
  // params object, so recomputing "now" on every render would generate a
  // new query key (and a new network request) every single render.
  const { startTime, endTime } = useMemo(() => ({
    startTime: moment().subtract(36, 'hours').toISOString(),
    endTime: moment().toISOString(),
  }), []);
  const { data: records } = useSleepRecords({ side, startTime, endTime });
  // Same pick as the Sleep page: the longest record of the newest wake date.
  const last = useMemo(() => {
    if (!timeZone) return undefined;
    const sideRecords = records?.filter(record => record.side === side) ?? [];
    const newest = [...sideRecords].sort((a, b) => Date.parse(b.left_bed_at) - Date.parse(a.left_bed_at))[0];
    return newest && recordForNight(sideRecords, moment.tz(newest.left_bed_at, timeZone).format('YYYY-MM-DD'), timeZone);
  }, [records, side, timeZone]);

  const { data: score } = useSleepScore(
    {
      side,
      startTime: last?.entered_bed_at,
      endTime: last?.left_bed_at,
    },
    sleepScoreEnabled && !!last,
  );

  if (!sleepScoreEnabled || !last || !score?.active || !Number.isFinite(score.score) || score.score === null) return undefined;
  const duration = score.components.duration;
  return { score: score.score, duration: duration?.available && duration.value ? duration.value : undefined };
}
