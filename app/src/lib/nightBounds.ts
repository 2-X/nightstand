import moment from 'moment-timezone';

export function nightBounds(date: moment.Moment, power: { on: string; off: string }) {
  const atTime = (time: string) => {
    const [hour, minute] = time.split(':').map(Number);
    return date.clone().startOf('day').hour(hour).minute(minute);
  };
  const start = atTime(power.on);
  const end = atTime(power.off);
  if (power.off <= power.on) end.add(1, 'day');
  return { start, end };
}
