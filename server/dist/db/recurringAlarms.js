// LowDB store for Phase 2 recurring alarms, in its own file
// (/persistent/free-sleep-data/lowdb/recurringAlarmsDB.json) so it does not
// perturb the day-of-week iteration over schedulesDB elsewhere.
//
// On first load (empty file, or a file that predates this feature) the legacy
// per-day alarms in schedulesDB are folded into this list once via the
// migration shim. A sentinel `_migrated` flag records that the one-time fold
// has happened so an intentionally-empty list (user deleted every alarm) is
// not re-populated from stale per-day data on the next boot.
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import { migrateLegacyAlarms } from './recurringAlarmsMigration.js';
import schedulesDB from './schedules.js';
import config from '../config.js';
import logger from '../logger.js';
const defaultData = { left: [], right: [], _migrated: false };
const file = new JSONFile(`${config.lowDbFolder}recurringAlarmsDB.json`);
const recurringAlarmsDB = new Low(file, defaultData);
await recurringAlarmsDB.read();
if (!recurringAlarmsDB.data) {
    recurringAlarmsDB.data = { left: [], right: [], _migrated: false };
}
// One-time migration: only when we have never migrated on this file.
if (!recurringAlarmsDB.data._migrated) {
    try {
        const migrated = migrateLegacyAlarms(schedulesDB.data);
        recurringAlarmsDB.data.left = migrated.left;
        recurringAlarmsDB.data.right = migrated.right;
        recurringAlarmsDB.data._migrated = true;
        const total = migrated.left.length + migrated.right.length;
        logger.info(`[recurringAlarms] migrated ${total} legacy alarm(s) into recurringAlarmsDB`);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn(`[recurringAlarms] legacy migration failed, starting empty: ${message}`);
        recurringAlarmsDB.data.left ??= [];
        recurringAlarmsDB.data.right ??= [];
        recurringAlarmsDB.data._migrated = true;
    }
    await recurringAlarmsDB.write();
}
// Guard against a hand-edited file missing a side.
recurringAlarmsDB.data.left ??= [];
recurringAlarmsDB.data.right ??= [];
export default recurringAlarmsDB;
//# sourceMappingURL=recurringAlarms.js.map