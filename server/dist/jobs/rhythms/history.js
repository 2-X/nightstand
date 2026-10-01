// One JSON line per finished Smart Schedule sleep, kept next to the lowdb
// folder (never inside it, so the job watcher ignores it).
import { readFile, rename, writeFile } from 'node:fs/promises';
import config from '../../config.js';
import logger from '../../logger.js';
export const HISTORY_FILE_NAME = 'rhythms-history.jsonl';
export const HISTORY_RETENTION_DAYS = 90;
const DAY = 24 * 60 * 60 * 1000;
export const historyPath = () => `${config.dbFolder}${HISTORY_FILE_NAME}`;
function isRecent(line, cutoff) {
    try {
        const parsed = JSON.parse(line);
        const at = typeof parsed.powerOff === 'string' ? Date.parse(parsed.powerOff) : Number.NaN;
        return Number.isFinite(at) && at >= cutoff;
    }
    catch {
        return false;
    }
}
// Appends one record and drops records whose sleep ended more than 90 days
// ago. Never throws: history must not affect the engine.
export async function appendHistory(record, options = {}) {
    try {
        const file = options.path ?? historyPath();
        const cutoff = (options.now ?? new Date()).getTime() - HISTORY_RETENTION_DAYS * DAY;
        let existing = '';
        try {
            existing = await readFile(file, 'utf8');
        }
        catch (error) {
            if (error.code !== 'ENOENT')
                throw error;
        }
        const lines = existing.split('\n').filter(line => line.trim() !== '' && isRecent(line, cutoff));
        lines.push(JSON.stringify(record));
        const temporary = `${file}.tmp`;
        await writeFile(temporary, `${lines.join('\n')}\n`, 'utf8');
        await rename(temporary, file);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn(`smart schedule: history not written: ${message}`);
    }
}
//# sourceMappingURL=history.js.map