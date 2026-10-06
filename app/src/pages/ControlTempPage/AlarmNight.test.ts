import { expect, it } from 'vitest';
import moment from 'moment-timezone';
import { getSchedules } from '../../mocks/mockData';
import { nextAlarmNight } from './AlarmNight';

it('keeps the alarm night active until its off time after the spring-forward change', () => {
  const zone = 'America/Los_Angeles';
  const schedule = structuredClone(getSchedules().left);
  for (const day of Object.values(schedule)) day.power.enabled = false;
  schedule.sunday.power = { enabled: true, on: '21:00', off: '02:30', onTemperature: 82 };
  schedule.sunday.alarm = { ...schedule.sunday.alarm, enabled: true, time: '23:00' };
  schedule.sunday.alarms = [];
  const night = nextAlarmNight(schedule, zone, moment.tz('2027-03-15 02:00', zone), {
    expiresAt: '2027-03-15T02:30:00-07:00',
  });
  expect(night?.end.format()).toBe('2027-03-15T02:30:00-07:00');
  expect(night?.alarms[0].at.format()).toBe('2027-03-14T23:00:00-07:00');
});
