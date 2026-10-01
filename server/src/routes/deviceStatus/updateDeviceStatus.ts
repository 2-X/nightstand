import _ from 'lodash';
import { DeepPartial } from 'ts-essentials';
import cbor from 'cbor';

import { DeviceStatus, MAX_ON_DURATION_SECONDS, SideStatus } from './deviceStatusSchema.js';
import { executeFunction } from '../../8sleep/deviceApi.js';
import { FrankenSupersededError } from '../../8sleep/frankenErrors.js';
import type { CommandOptions } from '../../8sleep/frankenServer.js';
import logger from '../../logger.js';
import settingsDB from '../../db/settings.js';
import memoryDB from '../../db/memoryDB.js';
import { INVERTED_SETTINGS_KEY_MAPPING } from '../../8sleep/loadDeviceStatus.js';
import { forgetKeptAlarms } from '../../jobs/rhythms/keptAlarms.js';

// Inverse of loadDeviceStatus.ts's calculateTempInF. Same fixed firmware
// level scale, so the two files must be changed together.
const calculateLevelFromF = (temperatureF: number) => {
  const level = (temperatureF - 82.5) / 27.5 * 100;
  return Math.round(level).toString();
};

const updateSide = async (side: 'left' | 'right', sideStatus: DeepPartial<SideStatus>, options: CommandOptions) => {
  await settingsDB.read();
  const settings = settingsDB.data;
  if (side === 'left') {
    if (settings.left.awayMode) {
      logger.warn('Left side is in away mode, not updating side');
    }
  } else {
    if (settings.right.awayMode) {
      logger.warn('Right side is in away mode, not updating side');
    }
  }
  const controlBothSides = settings.left.awayMode || settings.right.awayMode;
  const updateLeft = side === 'left' || controlBothSides;
  const updateRight = side === 'right' || controlBothSides;

  const { isOn, targetTemperatureF, secondsRemaining, isAlarmVibrating } = sideStatus;
  // Scheduled power and set point changes stay correct when applied late, so
  // they wait out an outage; only the newest one per setting is applied.
  const stateOptions = { ...options, latest: true };

  if (controlBothSides) {
    logger.debug('One side is in away mode, updating both sides...');
  }

  if (isOn !== undefined) {
    const onDuration = isOn ? String(MAX_ON_DURATION_SECONDS) : '0';
    if (updateLeft) await executeFunction('LEFT_TEMP_DURATION', onDuration, stateOptions);
    if (updateRight) await executeFunction('RIGHT_TEMP_DURATION', onDuration, stateOptions);
    // A side turned off ends the sleep it was kept on for.
    if (!isOn) {
      if (updateLeft) forgetKeptAlarms('left');
      if (updateRight) forgetKeptAlarms('right');
    }
  }

  if (targetTemperatureF !== undefined) {
    const level = calculateLevelFromF(targetTemperatureF);
    if (updateLeft) await executeFunction('TEMP_LEVEL_LEFT', level, stateOptions);
    if (updateRight) await executeFunction('TEMP_LEVEL_RIGHT', level, stateOptions);
  }

  if (secondsRemaining) {
    const seconds = Math.round(secondsRemaining).toString();
    if (updateLeft) await executeFunction('LEFT_TEMP_DURATION', seconds, stateOptions);
    if (updateRight) await executeFunction('RIGHT_TEMP_DURATION', seconds, stateOptions);
  }

  if (isAlarmVibrating !== undefined) {
    logger.debug('Can only set isAlarmVibrating to false for now...');
    if (!isAlarmVibrating) await executeFunction('ALARM_CLEAR', 'empty', options);
    await memoryDB.read();
    memoryDB.data[side].isAlarmVibrating = false;
    await memoryDB.write();
  }
};


const updateSettings = async (settings: Partial<DeviceStatus['settings']>, options: CommandOptions) => {
  const renamedSettings = _.mapKeys(settings, (value, key) => INVERTED_SETTINGS_KEY_MAPPING[key] || key);
  const encodedBuffer = cbor.encode(renamedSettings);
  const hexString = encodedBuffer.toString('hex');
  await executeFunction('SET_SETTINGS', hexString, options);
};

// Scheduled callers pass { background: true } to wait longer for the hardware.
export const updateDeviceStatus = async (deviceStatus: DeepPartial<DeviceStatus>, options: CommandOptions = {}) => {
  logger.info(`Updating device status..`);

  try {
    if (deviceStatus.isPriming === true) await executeFunction('PRIME', 'empty', options);
    else if (deviceStatus.isPriming === false) await executeFunction('STOP_PRIME', 'empty', options);
    if (deviceStatus?.left) await updateSide('left', deviceStatus.left, options);
    if (deviceStatus?.right) await updateSide('right', deviceStatus.right, options);
    if (deviceStatus?.settings) await updateSettings(deviceStatus.settings, options);
  } catch (error) {
    if (!(error instanceof FrankenSupersededError)) throw error;
    logger.info('Dropped an update replaced by a newer one while the Pod was unreachable');
    return;
  }
  logger.info('Finished updating device status');
};
