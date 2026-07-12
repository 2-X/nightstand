import { spawn } from 'child_process';
import logger from '../logger.js';

export function triggerUpdateService() {
  logger.debug('Starting free-sleep-update.service...');
  const child = spawn('sudo', ['/bin/systemctl', 'start', 'free-sleep-update.service', '--no-block'], {
    stdio: 'ignore',
    detached: true,
  });
  child.unref();
}

export default function update() {
  triggerUpdateService();
}
