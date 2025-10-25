// LowDB, stores the schedules in /persistent/free-sleep-data/lowdb/schedulesDB.json
import _ from 'lodash';
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import { Services } from './servicesSchema.js';
import config from '../config.js';


const defaultData: Services = {
  sentryLogging: {
    enabled: false,
  },
  biometrics: {
    enabled: false,
    installScriptComplete: false,
    jobs: {
      stream: {
        name: 'Biometrics stream',
        message: '',
        status: 'not_started',
        description: 'Consumes the RAW files as a stream and calculates biometrics',
        timestamp: '',
      },
      calibrateLeft: {
        name: 'Calibration job - Left',
        message: '',
        status: 'not_started',
        description: 'Calculates presence thresholds for cap sensor data',
        timestamp: '',
      },
      calibrateRight: {
        name: 'Calibration job - Right',
        message: '',
        status: 'not_started',
        description: 'Calculates presence thresholds for cap sensor data',
        timestamp: '',
      }
    }
  }
};



const file = new JSONFile<Services>(`${config.lowDbFolder}servicesDB.json`);
const servicesDB = new Low<Services>(file, defaultData);
await servicesDB.read();
// Allows us to add default values to the services if users have existing servicesDB.json data
servicesDB.data = _.merge({}, defaultData, servicesDB.data);
await servicesDB.write();

export default servicesDB;
