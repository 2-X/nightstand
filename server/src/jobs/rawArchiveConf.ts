import { rename, writeFile } from 'node:fs/promises';
import config from '../config.js';
import logger from '../logger.js';

// Read by scripts/archive-raw.sh, which runs as root on a timer and cannot
// see the settings database.
export const rawArchiveConfPath = () => `${config.dbFolder}raw-archive.conf`;

export async function writeRawArchiveConf(retentionDays: number, confPath = rawArchiveConfPath()) {
  const tmp = `${confPath}.tmp`;
  await writeFile(tmp, `RETENTION_HOURS=${retentionDays * 24}\n`);
  await rename(tmp, confPath);
}

// Never fails the caller: without the file the script keeps its default.
export async function syncRawArchiveConf(retentionDays: number) {
  try {
    await writeRawArchiveConf(retentionDays);
  } catch (error) {
    logger.warn(`Failed to write the raw archive retention: ${error instanceof Error ? error.message : String(error)}`);
  }
}
