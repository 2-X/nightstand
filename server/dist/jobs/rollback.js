import { spawn } from 'child_process';
import logger from '../logger.js';
export function triggerRollbackService() {
    logger.debug('Starting free-sleep-rollback.service...');
    const child = spawn('sudo', ['/bin/systemctl', 'start', 'free-sleep-rollback.service', '--no-block'], {
        stdio: 'ignore',
        detached: true,
    });
    child.unref();
}
//# sourceMappingURL=rollback.js.map