import moment from 'moment-timezone';

import type { DayOfWeek, SideSchedule, Time } from '@api/schedulesSchema.ts';


const DAYS_OF_WEEK: DayOfWeek[] = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

type TemperatureAdjustment = {
  occursAt: moment.Moment;
  scheduleDay: DayOfWeek;
  temperatureF: number;
  time: Time;
};

type ScheduleInterval = {
  endsAt: moment.Moment;
  onTemperatureF: number;
  scheduleDay: DayOfWeek;
  startsAt: moment.Moment;
  temperatureAdjustments: TemperatureAdjustment[];
};

const getScheduleDay = (scheduleDate: moment.Moment): DayOfWeek => {
  const scheduleDay = scheduleDate.format('dddd').toLowerCase() as DayOfWeek;
  return DAYS_OF_WEEK.includes(scheduleDay) ? scheduleDay : 'sunday';
};

const getTimeOnScheduleDate = (scheduleDate: moment.Moment, time: Time, timeZone: string) => {
  const hour = Number(time.slice(0, 2));
  const minute = Number(time.slice(3, 5));

  return scheduleDate.clone()
    .tz(timeZone)
    .hour(hour)
    .minute(minute)
    .second(0)
    .millisecond(0);
};

const getTemperatureAdjustments = (
  sideSchedule: SideSchedule,
  scheduleDay: DayOfWeek,
  scheduleDate: moment.Moment,
  startsAt: moment.Moment,
  endsAt: moment.Moment,
  timeZone: string
): TemperatureAdjustment[] => {
  const dailySchedule = sideSchedule[scheduleDay];
  const temperatureEntries = Object.entries(dailySchedule.temperatures) as [Time, number][];

  return temperatureEntries
    .map(([time, temperatureF]) => {
      const occursAt = getTimeOnScheduleDate(scheduleDate, time, timeZone);
      if (occursAt.isBefore(startsAt)) occursAt.add(1, 'day');

      return {
        occursAt,
        scheduleDay,
        temperatureF,
        time,
      };
    })
    .filter(({ occursAt }) => occursAt.isSameOrAfter(startsAt) && occursAt.isBefore(endsAt))
    .sort((firstAdjustment, secondAdjustment) => firstAdjustment.occursAt.valueOf() - secondAdjustment.occursAt.valueOf());
};

const getScheduleInterval = (
  sideSchedule: SideSchedule,
  scheduleDate: moment.Moment,
  timeZone: string
): ScheduleInterval | undefined => {
  const scheduleDay = getScheduleDay(scheduleDate);
  const dailySchedule = sideSchedule[scheduleDay];

  if (!dailySchedule.power.enabled) return undefined;

  const startsAt = getTimeOnScheduleDate(scheduleDate, dailySchedule.power.on, timeZone);
  const endsAt = getTimeOnScheduleDate(scheduleDate, dailySchedule.power.off, timeZone);
  if (!endsAt.isAfter(startsAt)) endsAt.add(1, 'day');

  return {
    endsAt,
    onTemperatureF: dailySchedule.power.onTemperature,
    scheduleDay,
    startsAt,
    temperatureAdjustments: getTemperatureAdjustments(
      sideSchedule,
      scheduleDay,
      scheduleDate,
      startsAt,
      endsAt,
      timeZone
    ),
  };
};

const getScheduleIntervals = (
  sideSchedule: SideSchedule,
  timeZone: string,
  now: moment.Moment
): ScheduleInterval[] => {
  const intervals: ScheduleInterval[] = [];

  // Search nearby schedule days so overnight intervals can be evaluated with absolute times.
  for (let dayOffset = -1; dayOffset <= 7; dayOffset++) {
    const scheduleDate = now.clone().tz(timeZone).startOf('day').add(dayOffset, 'day');
    const interval = getScheduleInterval(sideSchedule, scheduleDate, timeZone);
    if (interval) intervals.push(interval);
  }

  return intervals.sort((firstInterval, secondInterval) => firstInterval.startsAt.valueOf() - secondInterval.startsAt.valueOf());
};

const getRelevantScheduleInterval = (
  sideSchedule: SideSchedule,
  timeZone: string,
  now: moment.Moment
) => {
  const intervals = getScheduleIntervals(sideSchedule, timeZone, now);
  return intervals.find(interval => now.isBefore(interval.endsAt));
};

export const getScheduledTargetTemperature = (
  sideSchedule: SideSchedule | undefined,
  timeZone: string | undefined,
  now: moment.Moment = moment()
) => {
  if (!sideSchedule || !timeZone) return undefined;

  const scheduleNow = now.clone().tz(timeZone);
  const interval = getRelevantScheduleInterval(sideSchedule, timeZone, scheduleNow);
  if (!interval) return undefined;

  if (scheduleNow.isBefore(interval.startsAt)) return interval.onTemperatureF;

  // Match the temperature that would already be active if the schedule had stayed on.
  const activeAdjustments = interval.temperatureAdjustments
    .filter(adjustment => !adjustment.occursAt.isAfter(scheduleNow));
  const activeAdjustment = activeAdjustments[activeAdjustments.length - 1];

  return activeAdjustment?.temperatureF ?? interval.onTemperatureF;
};

export const getNextScheduledTemperatureChange = (
  sideSchedule: SideSchedule | undefined,
  timeZone: string | undefined,
  now: moment.Moment = moment()
): TemperatureAdjustment | undefined => {
  if (!sideSchedule || !timeZone) return undefined;

  const scheduleNow = now.clone().tz(timeZone);
  const interval = getRelevantScheduleInterval(sideSchedule, timeZone, scheduleNow);
  if (!interval) return undefined;

  return interval.temperatureAdjustments.find(adjustment => adjustment.occursAt.isAfter(scheduleNow));
};
