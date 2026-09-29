// Steno writes hidden temporary files before renaming them over the JSON file.
export function isScheduleDbChange(fileName: string): boolean {
  return ['settingsDB.json', 'schedulesDB.json', '.settingsDB.json.tmp', '.schedulesDB.json.tmp'].includes(fileName);
}
