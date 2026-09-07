// This is for storing data in memory when we don't want to update any files in the config.dbFolder
// Updating files in the config.dbFolder will re-trigger job deletion and creation
// This only keeps track of if the alarm is running, since we can't get that programmatically from the pod
import { Low, Memory } from 'lowdb';

type SideState = {
  isAlarmVibrating: boolean;
  // Epoch ms of the last alarm that actually fired. Used to swallow a repeat
  // firing of the same wall-clock time, which happens on the DST fall-back
  // day when a time between 01:00 and 01:59 occurs twice.
  lastAlarmFiredAt?: number;
  // Epoch ms of the last real dismissal (middle button or app clearing the
  // alarm via updateDeviceStatus({isAlarmVibrating:false})). The deadline
  // re-fire loop stops as soon as this is newer than lastAlarmFiredAt; the
  // per-duration self-clear timer flips isAlarmVibrating false regardless of
  // dismissal, so isAlarmVibrating alone cannot tell "stopped buzzing" from
  // "user dismissed".
  lastAlarmDismissedAt?: number;
  analyzeSleep: {
    lastRan?: number;
  }
};

type BaseStatus = {
  head: number;
  feet: number;
  isMoving: boolean;
  lastUpdate: string;
  isConfigured: boolean;
};

type MemoryDB = {
  left: SideState;
  right: SideState;
  baseStatus?: BaseStatus;
};

const defaultMemoryDB: MemoryDB = {
  left: {
    isAlarmVibrating: false,
    lastAlarmFiredAt: undefined,
    analyzeSleep: {
      lastRan: undefined,
    }
  },
  right: {
    isAlarmVibrating: false,
    lastAlarmFiredAt: undefined,
    analyzeSleep: {
      lastRan: undefined,
    }
  },
};

const adapter = new Memory<MemoryDB>();
const memoryDB = new Low<MemoryDB>(adapter, defaultMemoryDB);

await memoryDB.read();
memoryDB.data = memoryDB.data || defaultMemoryDB;
await memoryDB.write();

export default memoryDB;
