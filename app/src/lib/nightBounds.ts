import moment from 'moment-timezone';

export function nightBounds(date: moment.Moment, power: { on: string; off: string }) {
  const [onHour, onMinute] = power.on.split(':').map(Number);
  const [offHour, offMinute] = power.off.split(':').map(Number);
  const start = date.clone().startOf('day').hour(onHour).minute(onMinute);
  const end = date.clone().startOf('day');
  if (power.off <= power.on) end.add(1, 'day');
  end.hour(offHour).minute(offMinute);
  return { start, end };
}
