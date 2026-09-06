// Daily retention prune for the Phase 0 collector tables. Nothing prunes
// SQLite today (docs/DATA.md disk constraint), so every new table ships with
// retention.
//
// Intentionally NOT scheduled via node-schedule inside jobs/jobScheduler.ts:
// setupJobs() cancels *every* node-schedule job on each chokidar-triggered
// rebuild, which would silently drop a job registered there. This uses its own
// unref'd interval so it survives schedule rebuilds and never holds the
// process open.

import logger from '../logger.js';
import { pruneOldRows } from '../db/collector.js';

// Check once every 24h. First prune runs one interval after startup (the pod
// reboots daily, so this reliably fires within a day of any given boot).
const RETENTION_CHECK_MS = 24 * 60 * 60 * 1000;

let timer: NodeJS.Timeout | undefined;

export function startRetentionJob(): void {
  if (timer) {
    logger.warn('[retention] startRetentionJob called twice, ignoring');
    return;
  }
  timer = setInterval(() => {
    // pruneOldRows swallows and logs its own errors; the extra catch guards
    // against a synchronous throw ever reaching the process-level
    // unhandledRejection handler (which shuts the server down).
    void pruneOldRows().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`[retention] prune threw: ${message}`);
    });
  }, RETENTION_CHECK_MS);
  timer.unref?.();
  logger.info('[retention] daily retention job started');
}

export function stopRetentionJob(): void {
  if (timer) {
    clearInterval(timer);
    timer = undefined;
  }
}
