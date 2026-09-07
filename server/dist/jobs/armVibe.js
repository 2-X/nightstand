// Best-effort arming of the pod's vibration motor before a smart-wake session
// or a deadline alarm fires.
//
// The pod ships a small helper (`arm_vibe.py`) that sends the firmware
// EnableVibration (0x2E) command; it is idempotent and lives ONLY on the pod,
// not in this repo. On local dev / CI the file is absent, so we access-check
// first and silently skip - exactly the guard executePythonScript uses for the
// Python interpreter. A missing armer must never be an error.
//
// The command path is a config constant so it is trivial to point elsewhere;
// override via env for a non-standard pod layout.
import { exec } from 'child_process';
import fs from 'fs';
import logger from '../logger.js';
const { promises: fsPromises } = fs;
// Config constants. The venv python + the armer script both live on the pod.
export const ARM_VIBE_PYTHON = process.env.ARM_VIBE_PYTHON || '/home/dac/venv/bin/python';
export const ARM_VIBE_SCRIPT = process.env.ARM_VIBE_SCRIPT || '/home/root/vibe/arm_vibe.py';
/**
 * Spawn the vibration armer, best effort. Resolves either way; never throws.
 * Skips silently when either the interpreter or the script is missing (local
 * dev), matching executePythonScript's access-check-then-skip behavior.
 */
export async function armVibe() {
    try {
        await fsPromises.access(ARM_VIBE_PYTHON, fs.constants.X_OK);
        await fsPromises.access(ARM_VIBE_SCRIPT, fs.constants.R_OK);
    }
    catch {
        logger.debug(`[armVibe] armer not present (${ARM_VIBE_SCRIPT}); skipping`);
        return;
    }
    const command = `${ARM_VIBE_PYTHON} -B ${ARM_VIBE_SCRIPT}`;
    logger.info(`[armVibe] arming vibration: ${command}`);
    await new Promise((resolve) => {
        exec(command, { env: { ...process.env } }, (error, _stdout, stderr) => {
            if (error) {
                // Python's logging goes to stderr; error.message alone is usually just
                // "Command failed". Log both but never reject - the deadline alarm and
                // the session must proceed regardless of whether arming succeeded.
                logger.warn(`[armVibe] arm_vibe failed: ${error.message}${stderr ? `\n${stderr}` : ''}`);
            }
            resolve();
        });
    });
}
//# sourceMappingURL=armVibe.js.map