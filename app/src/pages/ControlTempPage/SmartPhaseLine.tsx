import { Fragment } from 'react';
import { Box, Typography } from '@mui/material';
import { useRhythmsLive } from '@api/rhythms';
import { useSettings } from '@api/settings';
import type { ResolvedSleepResponse } from '@api/rhythmsResponse';
import type { Side } from '@state/appStore';
import { fahrenheitToLevel } from '@lib/temperatureConversions';
import { smartLineForSleep } from './smartPhase';
import { tonightLineSx } from './tonightStyles';
import { useBedFrame } from './useBedFrame';

// A Smart Schedule hold lives in the server's memory, not in settings, so the
// hold and the delayed cool-down come from GET /rhythms/live.
export default function SmartPhaseLine({ sleep, side }: { sleep: ResolvedSleepResponse; side: Side }) {
  const { data: settings } = useSettings();
  const { data: deviceStatus, frame } = useBedFrame();
  const { data: live, isError: liveFailed } = useRhythmsLive(side);
  // While the bed is not responding, its caption already says schedules may not run.
  if (!settings || frame.kind !== 'live') return null;
  const now = new Date();
  const night = !liveFailed && live?.date === sleep.date ? live : undefined;
  const target = deviceStatus?.[side]?.targetTemperatureF;
  const until = night?.hold ? new Date(night.hold.until) : undefined;
  const line = smartLineForSleep(sleep, {
    now,
    timeZone: settings.timeZone,
    format: settings.temperatureFormat,
    waiting: !!night?.waiting,
    runtime: night ? 'live' : 'unknown',
    coolStart: night ? new Date(night.coolStart) : undefined,
    hold: until && until > now && target !== undefined ? { level: fahrenheitToLevel(target), until } : undefined,
    base: night?.baseSince && sleep.smart ? { level: sleep.smart.baseLevel, since: new Date(night.baseSince) } : undefined,
  });
  if (!line) return null;
  // "wake-up" never breaks at its hyphen.
  const parts = line.split('wake-up');
  return <Typography sx={ tonightLineSx }>
    { parts.map((part, index) => <Fragment key={ index }>
      { index > 0 && <Box component="span" sx={ { whiteSpace: 'nowrap' } }>wake-up</Box> }
      { part }
    </Fragment>) }
  </Typography>;
}
