import schedule from 'node-schedule';
import { Settings } from '../db/settingsSchema.js';
import { DailySchedule, DayOfWeek, Side, Time } from '../db/schedulesSchema.js';
import memoryDB from '../db/memoryDB.js';
import logger from '../logger.js';
import { getDayOfWeekIndex } from './utils.js';
import cbor from 'cbor';
import moment from 'moment-timezone';
import { executeFunction } from '../8sleep/deviceApi.js';


function isEndTimeSameDay(endTime: Time) {
  const endHour = Number(endTime.split(':')[0]);
  return endHour > 11;
}

export const scheduleAlarm = (settingsData: Settings, side: Side, day: DayOfWeek, dailySchedule: DailySchedule) => {
  if (!dailySchedule.power.enabled) return;
  if (!dailySchedule.alarm.enabled) return;
  if (settingsData[side].awayMode) return;
  if (settingsData.timeZone === null) return;

  const alarmRule = new schedule.RecurrenceRule();
  // Handle if someone has odd sleeping schedule for w/e reason (goes to bed at 13:00, wakes up at 21:00)
  if (isEndTimeSameDay(dailySchedule.power.off)) {
    alarmRule.dayOfWeek = getDayOfWeekIndex(day);
  } else {
    alarmRule.dayOfWeek = getDayOfWeekIndex(day) + 1;
  }

  const [alarmHour, alarmMinute] = dailySchedule.alarm.time.split(':').map(Number);
  alarmRule.hour = alarmHour;
  alarmRule.minute = alarmMinute;
  alarmRule.tz = settingsData.timeZone;

  logger.debug(`Scheduling alarm job for ${side} side on ${day} at ${dailySchedule.alarm.time}`);

  schedule.scheduleJob(`${side}-${day}-alarm`, alarmRule, async () => {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const currentTime = moment.tz(settingsData.timeZone!);
    const alarmTimeEpoch = currentTime.unix();

    const alarmPayload = {
      pl: dailySchedule.alarm.vibrationIntensity,
      du: dailySchedule.alarm.duration,
      pi: dailySchedule.alarm.vibrationPattern,
      tt: alarmTimeEpoch,
    };

    const cborPayload = cbor.encode(alarmPayload);
    const hexPayload = cborPayload.toString('hex');
    const command = side === 'left' ? 'ALARM_LEFT' : 'ALARM_RIGHT';

    logger.info(`Executing scheduled alarm job for ${side} side on ${day} at ${dailySchedule.alarm.time}`);

    await executeFunction(command, hexPayload);
    await memoryDB.read();
    memoryDB.data[side].isAlarmVibrating = true;
    await memoryDB.write();

    setTimeout(
      async () => {
        logger.debug(`Clearing alarm status for ${side} side on ${day} at ${dailySchedule.alarm.time}`);
        await memoryDB.read();
        memoryDB.data[side].isAlarmVibrating = false;
        await memoryDB.write();
      },
      dailySchedule.alarm.duration * 1_000
    );
  });
};


