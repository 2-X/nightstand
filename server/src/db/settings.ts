// LowDB, stores the schedules in /persistent/free-sleep-data/lowdb/settingsDB.json
import _ from 'lodash';
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';

import { Settings } from './settingsSchema.js';
import config from '../config.js';


const defaultData: Settings = {
  id: crypto.randomUUID(),
  timeZone: 'UTC',
  temperatureFormat: 'fahrenheit',
  rebootDaily: true,
  left: {
    name: 'Left',
    awayMode: false,
    scheduleOverrides: {
      temperatureSchedules: {
        disabled: false,
        expiresAt: ''
      },
      alarm: {
        disabled: false,
        timeOverride: '',
        expiresAt: '',
      }
    },
  },
  right: {
    name: 'Right',
    awayMode: false,
    scheduleOverrides: {
      temperatureSchedules: {
        disabled: false,
        expiresAt: ''
      },
      alarm: {
        disabled: false,
        timeOverride: '',
        expiresAt: '',
      }
    },
  },
  primePodDaily: {
    enabled: false,
    time: '14:00',
  },
};

const file = new JSONFile<Settings>(`${config.lowDbFolder}settingsDB.json`);
const settingsDB = new Low<Settings>(file, defaultData);
await settingsDB.read();
// Allows us to add default values to the settings if users have existing settingsDB.json data
settingsDB.data = _.merge({}, defaultData, settingsDB.data);
await settingsDB.write();

export default settingsDB;
