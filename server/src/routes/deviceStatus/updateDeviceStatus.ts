import { DeepPartial } from 'ts-essentials';

import { DeviceStatus, SideStatus } from './deviceStatusSchema.js';
import { executeFunction } from '../../8sleep/deviceApi.js';
import logger from '../../logger.js';
import settingsDB from '../../db/settings.js';
import memoryDB from '../../db/memoryDB.js';


const calculateLevelFromF = (temperatureF: number) => {
  const level = (temperatureF - 82.5) / 27.5 * 100;
  return Math.round(level).toString();
};

const updateSide = async (side: 'left' | 'right', sideStatus: DeepPartial<SideStatus>) => {
  await settingsDB.read();
  const settings = settingsDB.data;
  const controlBothSides = settings.left.awayMode || settings.right.awayMode;
  const updateLeft = side === 'left' || controlBothSides;
  const updateRight = side === 'right' || controlBothSides;

  const { isOn, targetTemperatureF, secondsRemaining, isAlarmVibrating } = sideStatus;

  if (controlBothSides) {
    logger.debug('One side is in away mode, updating both sides...');
  }

  if (isOn !== undefined) {
    const onDuration = isOn ? '43200' : '0';
    if (updateLeft) await executeFunction('LEFT_TEMP_DURATION', onDuration);
    if (updateRight) await executeFunction('RIGHT_TEMP_DURATION', onDuration);
  }

  if (targetTemperatureF) {
    const level = calculateLevelFromF(targetTemperatureF);
    if (updateLeft) await executeFunction('TEMP_LEVEL_LEFT', level);
    if (updateRight) await executeFunction('TEMP_LEVEL_RIGHT', level);
  }

  if (secondsRemaining) {
    const seconds = Math.round(secondsRemaining).toString();
    if (updateLeft) await executeFunction('LEFT_TEMP_DURATION', seconds);
    if (updateRight) await executeFunction('RIGHT_TEMP_DURATION', seconds);
  }

  if (isAlarmVibrating !== undefined) {
    logger.debug('Can only set isAlarmVibrating to false for now...');
    if (!isAlarmVibrating) await executeFunction('ALARM_CLEAR', "empty");
    await memoryDB.read();
    memoryDB.data[side].isAlarmVibrating = false;
    await memoryDB.write();
  }
};


export const updateDeviceStatus = async (deviceStatus: DeepPartial<DeviceStatus>) => {
  logger.info(`Updating deviceStatus...`);

  if (deviceStatus.isPriming) await executeFunction('PRIME');
  if (deviceStatus?.left) await updateSide('left', deviceStatus.left);
  if (deviceStatus?.right) await updateSide('right', deviceStatus.right);

  logger.info('Finished updating device status');
};
