import { exec } from 'child_process';
import logger from '../logger.js';

export default function update() {
  logger.debug('Updating pod...');
  exec('sudo sh /home/dac/free-sleep/scripts/update.sh', (error, stdout, stderr) => {
    if (error) {
      logger.error(`Error: ${error.message}`);
      return;
    }
    if (stderr) {
      logger.error(`Stderr: ${stderr}`);
      return;
    }
    logger.debug(`Stdout: ${stdout}`);
  });
}
