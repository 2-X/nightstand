// This is for storing data in memory when we don't want to update any files in the config.dbFolder
// Updating files in the config.dbFolder will re-trigger job deletion and creation
import { Low, Memory } from 'lowdb';

type SideState = {
  isAlarmVibrating: boolean;
};

type MemoryDB = {
  left: SideState;
  right: SideState;
};

const defaultMemoryDB: MemoryDB = {
  left: {
    isAlarmVibrating: false,
  },
  right: {
    isAlarmVibrating: false,
  },
};

const adapter = new Memory<MemoryDB>();
const memoryDB = new Low<MemoryDB>(adapter, defaultMemoryDB);

await memoryDB.read();
memoryDB.data = memoryDB.data || defaultMemoryDB;
await memoryDB.write();

export default memoryDB;
