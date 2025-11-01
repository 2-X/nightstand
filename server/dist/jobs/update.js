
!function(){try{var e="undefined"!=typeof window?window:"undefined"!=typeof global?global:"undefined"!=typeof globalThis?globalThis:"undefined"!=typeof self?self:{},n=(new e.Error).stack;n&&(e._sentryDebugIds=e._sentryDebugIds||{},e._sentryDebugIds[n]="62e3ec9a-bc3e-56d3-a6c6-efd71d0a1aba")}catch(e){}}();
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
//# sourceMappingURL=update.js.map
//# debugId=62e3ec9a-bc3e-56d3-a6c6-efd71d0a1aba
