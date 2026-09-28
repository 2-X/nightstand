import type moment from 'moment-timezone';
import { scheduleWrapsToNextDay } from './utils.js';

export function nightBounds(date: moment.Moment, power: { on: string; off: string }) {
  const [onHour, onMinute] = power.on.split(':').map(Number);
  const [offHour, offMinute] = power.off.split(':').map(Number);
  const start = date.clone().startOf('day').hour(onHour).minute(onMinute);
  const end = date.clone().startOf('day');
  if (scheduleWrapsToNextDay(power)) end.add(1, 'day');
  end.hour(offHour).minute(offMinute);
  return { start, end };
}
