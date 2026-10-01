import { Typography } from '@mui/material';
import { useDeviceStatus } from '@api/deviceStatus';
import { useRhythmsLive } from '@api/rhythms';
import { useSettings } from '@api/settings';
import type { ResolvedSleepResponse } from '@api/rhythmsResponse';
import type { Side } from '@state/appStore';
import { fahrenheitToLevel } from '@lib/temperatureConversions';
import { smartLineForSleep } from './smartPhase';

// A Smart Schedule hold lives in the server's memory, not in settings, so the
// hold and the delayed cool-down come from GET /rhythms/live.
export default function SmartPhaseLine({ sleep, side }: { sleep: ResolvedSleepResponse; side: Side }) {
  const { data: settings } = useSettings();
  const { data: deviceStatus } = useDeviceStatus();
  const { data: live } = useRhythmsLive(side);
  if (!settings) return null;
  const now = new Date();
  const night = live?.date === sleep.date ? live : undefined;
  const target = deviceStatus?.[side]?.targetTemperatureF;
  const until = night?.hold ? new Date(night.hold.until) : undefined;
  const line = smartLineForSleep(sleep, {
    now,
    timeZone: settings.timeZone,
    format: settings.temperatureFormat,
    waiting: !!night?.waiting,
    coolStart: night ? new Date(night.coolStart) : undefined,
    hold: until && until > now && target !== undefined ? { level: fahrenheitToLevel(target), until } : undefined,
    base: night?.baseSince && sleep.smart ? { level: sleep.smart.baseLevel, since: new Date(night.baseSince) } : undefined,
  });
  return line ? <Typography variant="body2" sx={ { mb: 1 } }>{ line }</Typography> : null;
}
