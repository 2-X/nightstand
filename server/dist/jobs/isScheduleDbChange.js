const SCHEDULE_FILES = ['settingsDB.json', 'schedulesDB.json', 'rhythmsDB.json'];
// Steno writes hidden temporary files before renaming them over the JSON file.
export function isScheduleDbChange(fileName) {
    return SCHEDULE_FILES.some(name => fileName === name || fileName === `.${name}.tmp`);
}
//# sourceMappingURL=isScheduleDbChange.js.map