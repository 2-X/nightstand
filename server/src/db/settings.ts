// LowDB, stores the schedules in /persistent/free-sleep-data/lowdb/settingsDB.json
import _ from 'lodash';
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';

import { Settings, SideSettings, defaultFeatures } from './settingsSchema.js';
import config from '../config.js';

const defaultSideSettings: SideSettings = {
  name: 'Side',
  awayMode: false,
  alarmsEnabled: true,
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
  oneOffAlarm: {
    enabled: false,
    fireAt: '',
    vibrationIntensity: 100,
    vibrationPattern: 'rise',
    duration: 30,
  },
  taps: {
    doubleTap: {
      type: 'temperature',
      change: 'decrement',
      amount: 2,
    },
    tripleTap: {
      type: 'temperature',
      change: 'increment',
      amount: 2,
    },
    quadTap: {
      type: 'base_control',
      behavior: 'toggle_preset',
    },
  }
};

const defaultData: Settings = {
  id: crypto.randomUUID(),
  timeZone: 'UTC',
  temperatureFormat: 'fahrenheit',
  rebootDaily: true,
  updateChannel: 'stable',
  left: {
    ..._.cloneDeep(defaultSideSettings),
    name: 'Left',
  },
  right: {
    ..._.cloneDeep(defaultSideSettings),
    name: 'Right',
  },
  primePodDaily: {
    enabled: false,
    time: '14:00',
  },
  features: { ...defaultFeatures },
};

const file = new JSONFile<Settings>(`${config.lowDbFolder}settingsDB.json`);
const settingsDB = new Low<Settings>(file, defaultData);
await settingsDB.read();
// Allows us to add default values to the settings if users have existing settingsDB.json data
settingsDB.data = _.merge({}, defaultData, settingsDB.data);

// Migration: bump temperature tap amount from old default of 1 to 2.
for (const sideKey of ['left', 'right'] as const) {
  for (const gesture of ['doubleTap', 'tripleTap'] as const) {
    const tap = settingsDB.data[sideKey].taps[gesture];
    if (tap.type === 'temperature' && tap.amount === 1) {
      tap.amount = 2;
    }
  }
}

// Migration: force-upgrade quadTap from 'alarm' to 'base_control' if it's
// still the old default (a user who deliberately picked 'alarm' would have
// a different snoozeDuration/inactiveAlarmBehavior than the stock default,
// but there is no such per-user UI yet, so any 'alarm' quadTap is the old
// default, not a preference to preserve).
if (settingsDB.data.left.taps.quadTap.type === 'alarm') {
  const baseControlTap = {
    type: 'base_control' as const,
    behavior: 'toggle_preset' as const,
  };
  settingsDB.data.left.taps.quadTap = baseControlTap;
  settingsDB.data.right.taps.quadTap = baseControlTap;
}

await settingsDB.write();

export default settingsDB;
