import { exec } from 'child_process';
import { assertOperationsIdle } from './privilegedCommand.js';
import logger from '../logger.js';
export default async function reboot() {
    await assertOperationsIdle();
    logger.debug('Rebooting pod...');
    exec('sudo /sbin/reboot', (error, stdout, stderr) => {
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
//# sourceMappingURL=reboot.js.map