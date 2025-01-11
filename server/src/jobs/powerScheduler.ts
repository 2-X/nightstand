import schedule from 'node-schedule';
import { Settings } from '../db/settingsSchema.js';
import { DailySchedule, DayOfWeek, Side, Time } from '../db/schedulesSchema.js';
import logger from '../logger.js';
import { updateDeviceStatus } from '../routes/deviceStatus/updateDeviceStatus.js';
import { getDayOfWeekIndex } from './utils.js';


export const schedulePowerOn = (settingsData: Settings, side: Side, day: DayOfWeek, power: DailySchedule['power']) => {
  if (!power.enabled) return;
  if (settingsData[side].awayMode) return;
  if (settingsData.timeZone === null) return;

  const onRule = new schedule.RecurrenceRule();
  onRule.dayOfWeek = getDayOfWeekIndex(day);
  const [onHour, onMinute] = power.on.split(':').map(Number);
  const time =  power.on;
  onRule.hour = onHour;
  onRule.minute = onMinute;
  onRule.tz = settingsData.timeZone;

  logger.debug(`Scheduling power on for ${side} side on ${day} at ${power.on} at ${power.onTemperature}°F`);
  schedule.scheduleJob(`${side}-${day}-${time}-power-on`, onRule, async () => {
    logger.info(`Executing scheduled power on job for ${side} side on ${day} at ${power.on} at ${power.onTemperature}°F`);
    await updateDeviceStatus({
      [side]: {
        isOn: true,
        targetTemperatureF: power.onTemperature
      }
    });
  });
};

function isEndTimeSameDay(endTime: Time) {
  const endHour = Number(endTime.split(':')[0]);
  return endHour > 11;
}

export const schedulePowerOff = (settingsData: Settings, side: Side, day: DayOfWeek, power: DailySchedule['power']) => {
  if (!power.enabled) return;
  if (settingsData[side].awayMode) return;
  if (settingsData.timeZone === null) return;

  const offRule = new schedule.RecurrenceRule();
  // Handle if someone has odd sleeping schedule for w/e reason (goes to bed at 13:00, wakes up at 21:00)
  if (isEndTimeSameDay(power.off)) {
    offRule.dayOfWeek = getDayOfWeekIndex(day);
  } else {
    offRule.dayOfWeek = getDayOfWeekIndex(day) + 1;
  }
  const time = power.off;
  const [offHour, offMinute] = time.split(':').map(Number);
  offRule.hour = offHour;
  offRule.minute = offMinute;
  offRule.tz = settingsData.timeZone;
  logger.debug(`Scheduling power off job for ${side} side on ${day} at ${power.off}`);
  schedule.scheduleJob(`${side}-${day}-${time}-power-off`, offRule, async () => {
    logger.info(`Executing scheduled power off job for ${side} side on ${day} at ${power.off}`);
    await updateDeviceStatus({
      [side]: {
        isOn: false,
      }
    });
  });
};


