import logger from '../logger.js';
import { exec } from 'child_process';
import fs from 'fs';
export const logOutput = (data) => {
    const output = data.toString().trim();
    const logLines = output.split('\n');
    logLines.forEach(line => {
        const cleanedLine = line.split(' UTC | ')?.[1] || line;
        if (/\\bERROR\\b/.test(cleanedLine)) {
            logger.error(cleanedLine);
        }
        else if (/\\bDEBUG\\b/.test(cleanedLine)) {
            logger.debug(cleanedLine);
        }
        else if (/\\bINFO\\b/.test(cleanedLine)) {
            logger.info(cleanedLine);
        }
        else {
            logger.info(cleanedLine);
        }
    });
};
export const executePythonScript = ({ script, args = [] }) => {
    const pythonExecutable = '/home/dac/venv/bin/python';
    if (!fs.existsSync(pythonExecutable)) {
        logger.debug(`Not executing python script, ${pythonExecutable} does not exist!`);
        return;
    }
    const command = `${pythonExecutable} -B ${script} ${args.join(' ')}`;
    logger.info(`Executing: ${command}`);
    exec(command, { env: { ...process.env } }, (error, stdout, stderr) => {
        if (error) {
            logger.error(`Execution error: ${error.message}`);
            return;
        }
        if (stderr) {
            logger.error(`Python stderr: ${stderr}`);
        }
        if (stdout) {
            logger.info(`Python stdout: ${stdout}`);
        }
    });
};
