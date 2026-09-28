import { DailySchedule } from '@api/schedulesSchema';
import { minutesSincePowerOn } from './scheduleValidation';

export const OFF_DELAYS = [0, 15, 30, 60];

export function addMinutes(time: string, offset: number): string {
  const [hour, minute] = time.split(':').map(Number);
  const total = ((hour * 60 + minute + offset) % 1440 + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export function relativeOffDelay(alarm: string, off: string): number | undefined {
  const delay = minutesSincePowerOn(off, alarm);
  return OFF_DELAYS.includes(delay) ? delay : undefined;
}

export function wakeTemperatureTimes(schedule: DailySchedule, alarmTime: string | undefined): string[] {
  if (!alarmTime) return [];
  const alarmOffset = minutesSincePowerOn(alarmTime, schedule.power.on);
  const end = schedule.power.on === schedule.power.off ? 1440 : minutesSincePowerOn(schedule.power.off, schedule.power.on);
  const candidates = Object.keys(schedule.temperatures).filter(time => {
    const offset = minutesSincePowerOn(time, schedule.power.on);
    return offset > 0 && offset > alarmOffset - 60 && offset < alarmOffset && offset < end;
  }).sort((first, second) => minutesSincePowerOn(second, schedule.power.on) - minutesSincePowerOn(first, schedule.power.on));
  return candidates.slice(0, 1);
}

export function nextTemperatureChange(schedule: DailySchedule): { time: string; temperature: number } | undefined {
  const end = schedule.power.on === schedule.power.off ? 1440 : minutesSincePowerOn(schedule.power.off, schedule.power.on);
  const points = [{ offset: 0, temperature: schedule.power.onTemperature }, ...Object.entries(schedule.temperatures)
    .map(([time, temperature]) => ({ offset: minutesSincePowerOn(time, schedule.power.on), temperature }))
    .filter(point => point.offset > 0 && point.offset < end)].sort((first, second) => first.offset - second.offset);
  let best: { offset: number; gap: number; temperature: number } | undefined;
  points.forEach((point, index) => {
    const gap = (points[index + 1]?.offset ?? end) - point.offset;
    if (gap > 1 && (!best || gap > best.gap)) best = { offset: point.offset + Math.floor(gap / 2), gap, temperature: point.temperature };
  });
  return best ? { time: addMinutes(schedule.power.on, best.offset), temperature: best.temperature } : undefined;
}

// Clock values carry no date. Choose the occurrence nearest the existing night
// window; an evening before bedtime must not become the following evening just
// because clock subtraction wraps. At equal distances choose the earlier day.
export function canFollowWake(power: DailySchedule['power'], proposedOff: string): boolean {
  const currentEnd = power.on === power.off ? 1440 : minutesSincePowerOn(power.off, power.on);
  const offset = minutesSincePowerOn(proposedOff, power.on);
  const distance = (value: number) => value < 0 ? -value : Math.max(0, value - currentEnd);
  const candidates = [offset - 1440, offset, offset + 1440];
  const proposedEnd = candidates.reduce((nearest, candidate) =>
    distance(candidate) < distance(nearest) ? candidate : nearest);
  return proposedEnd > 0 && proposedEnd < 1440;
}
