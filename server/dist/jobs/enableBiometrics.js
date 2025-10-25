import logger from '../logger.js';
import { exec } from 'child_process';
export const enableBiometrics = () => {
    logger.info('Attempting to enable biometrics...');
    const scriptPath = '/home/dac/free-sleep/scripts/enable_biometrics.sh';
    const command = `bash ${scriptPath}`;
    // Run the shell script asynchronously
    exec(command, { env: { ...process.env } }, (error, stdout, stderr) => {
        if (error) {
            logger.error(`Enabling biometrics error: ${error.message}`);
            return;
        }
        if (stderr) {
            logger.error(`Enabling biometrics error: ${stderr.trim()}`);
        }
        if (stdout) {
            logger.info(`Enabling biometrics stdout: ${stdout.trim()}`);
        }
    });
};
