// lowdb (steno) writes to a hidden temp file first (e.g.
// .servicesDB.json.tmp) and atomically renames it over the real file, so a
// single logical write produces two separate chokidar 'change' events with
// different basenames. Matching only the final name lets the temp-file
// event slip through: every job-status write (stream/calibration/
// analyzeSleep health pings, every serverStatus poll that finds a stale
// stream) would then trigger a full cancel-and-reschedule of every job.
// That's expensive enough (1-2s) and frequent enough to block the event
// loop into failing deploy health checks under load.
export function isServicesDbChange(fileName: string): boolean {
  return fileName === 'servicesDB.json' || fileName === '.servicesDB.json.tmp';
}
