import logger from '../logger.js';
import { exec } from 'child_process';
import fs from 'fs';
const { promises: fsPromises } = fs;
export const executePythonScript = async ({ script, args = [] }) => {
    const pythonExecutable = '/home/dac/venv/bin/python';
    try {
        await fsPromises.access(pythonExecutable, fs.constants.X_OK);
    }
    catch {
        logger.debug(`Not executing python script, ${pythonExecutable} does not exist!`);
        return;
    }
    const command = `${pythonExecutable} -B ${script} ${args.join(' ')}`;
    logger.info(`Executing: ${command}`);
    exec(command, { env: { ...process.env } }, (error, stdout, stderr) => {
        if (error) {
            // stderr usually carries the actual traceback, error.message alone is
            // often just "Command failed with exit code 1".
            logger.error(`Execution error: ${error.message}${stderr ? `\n${stderr}` : ''}`);
            return;
        }
        // Python's logging module writes every level (DEBUG included) to stderr,
        // so a non-empty stderr here is routine, not evidence of failure, only
        // a non-zero exit (handled above) means the script actually failed.
        // Logging this at 'error' regardless of content used to bury real
        // problems under giant benign DEBUG dumps on every scheduled run.
        if (stderr) {
            logger.debug(`Python stderr: ${stderr}`);
        }
        if (stdout) {
            logger.debug(`Python stdout: ${stdout}`);
        }
    });
};
//# sourceMappingURL=executePython.js.map