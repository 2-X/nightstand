import { spawn } from 'child_process';
import logger from '../logger.js';
export function triggerRevertToStockService() {
    logger.debug('Starting free-sleep-revert.service...');
    const child = spawn('sudo', ['/bin/systemctl', 'start', 'free-sleep-revert.service', '--no-block'], {
        stdio: 'ignore',
        detached: true,
    });
    child.unref();
}
//# sourceMappingURL=revertToStock.js.map