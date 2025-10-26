// LowDB, stores the schedules in /persistent/free-sleep-data/lowdb/settingsDB.json

!function(){try{var e="undefined"!=typeof window?window:"undefined"!=typeof global?global:"undefined"!=typeof globalThis?globalThis:"undefined"!=typeof self?self:{},n=(new e.Error).stack;n&&(e._sentryDebugIds=e._sentryDebugIds||{},e._sentryDebugIds[n]="b60762cb-1150-5f13-a600-7a11b5ffbad5")}catch(e){}}();
import _ from 'lodash';
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import config from '../config.js';
const defaultData = {
    id: crypto.randomUUID(),
    timeZone: null,
    temperatureFormat: 'fahrenheit',
    rebootDaily: true,
    left: {
        name: 'Left',
        awayMode: false,
    },
    right: {
        name: 'Right',
        awayMode: false,
    },
    primePodDaily: {
        enabled: false,
        time: '14:00',
    },
};
const file = new JSONFile(`${config.lowDbFolder}settingsDB.json`);
const settingsDB = new Low(file, defaultData);
await settingsDB.read();
// Allows us to add default values to the settings if users have existing settingsDB.json data
settingsDB.data = _.merge({}, defaultData, settingsDB.data);
await settingsDB.write();
export default settingsDB;
//# sourceMappingURL=settings.js.map
//# debugId=b60762cb-1150-5f13-a600-7a11b5ffbad5
