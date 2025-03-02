import logger from '../logger.js';
import { exec } from 'child_process';
import fs from 'fs';

type ExecutePythonScriptArgs = {
  script: string;
  cwd?: string;
  args?: string[];
};
export const executePythonScript = ({ script, args = [] }: ExecutePythonScriptArgs) => {
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
