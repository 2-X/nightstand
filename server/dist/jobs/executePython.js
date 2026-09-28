import logger from '../logger.js';
import { exec } from 'child_process';
import fs from 'fs';
const { promises: fsPromises } = fs;
async function runPythonScript({ script, args = [] }) {
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
    await new Promise((resolve, reject) => {
        exec(command, { env: { ...process.env } }, (error, stdout, stderr) => {
            if (error) {
                // stderr usually carries the actual traceback, error.message alone is
                // often just "Command failed with exit code 1".
                reject(new Error(`${error.message}${stderr ? `\n${stderr}` : ''}`));
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
            resolve();
        });
    });
}
let executionQueue = Promise.resolve();
// Analysis and calibration share the server's memory budget.
export const executePythonScript = (options) => {
    executionQueue = executionQueue.then(() => runPythonScript(options)).catch((error) => {
        logger.error(`Execution error: ${error instanceof Error ? error.message : String(error)}`);
    });
    return executionQueue;
};
//# sourceMappingURL=executePython.js.map