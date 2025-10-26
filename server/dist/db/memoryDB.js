// This is for storing data in memory when we don't want to update any files in the config.dbFolder
// Updating files in the config.dbFolder will re-trigger job deletion and creation
// This only keeps track of if the alarm is running, since we can't get that programmatically from the pod

!function(){try{var e="undefined"!=typeof window?window:"undefined"!=typeof global?global:"undefined"!=typeof globalThis?globalThis:"undefined"!=typeof self?self:{},n=(new e.Error).stack;n&&(e._sentryDebugIds=e._sentryDebugIds||{},e._sentryDebugIds[n]="48457559-5fbf-5eb4-833d-b8eb847587cb")}catch(e){}}();
import { Low, Memory } from 'lowdb';
const defaultMemoryDB = {
    left: {
        isAlarmVibrating: false,
    },
    right: {
        isAlarmVibrating: false,
    },
};
const adapter = new Memory();
const memoryDB = new Low(adapter, defaultMemoryDB);
await memoryDB.read();
memoryDB.data = memoryDB.data || defaultMemoryDB;
await memoryDB.write();
export default memoryDB;
//# sourceMappingURL=memoryDB.js.map
//# debugId=48457559-5fbf-5eb4-833d-b8eb847587cb
