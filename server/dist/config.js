import { existsSync, readFileSync } from 'fs';
import logger from './logger.js';
function checkIfDacSockPathConfigured() {
    try {
        // Check if the file exists
        const filePath = '/persistent/free-sleep-data/dac_sock_path.txt';
        if (!existsSync(filePath)) {
            logger.debug(`dac.sock path not configured, defaulting to pod 3 path...`);
            return;
        }
        const data = readFileSync(filePath, 'utf8');
        // Remove all newline characters
        return data.replace(/\r?\n/g, '');
    }
    catch (error) {
        logger.error(error);
    }
}
const FRANK_SCRIPT = '/opt/eight/bin/frank.sh';
// The installer copies the firmware's socket path out of frank.sh; read it
// the same way when that copy is missing, rather than assume a Pod 3.
export function sockPathFromFrankScript(text) {
    return /DAC_SOCKET=([^\s]*dac\.sock)/.exec(text)?.[1];
}
function sockPathFromFirmware() {
    try {
        return existsSync(FRANK_SCRIPT) ? sockPathFromFrankScript(readFileSync(FRANK_SCRIPT, 'utf8')) : undefined;
    }
    catch (error) {
        logger.error(error);
        return undefined;
    }
}
// An empty copy counts as missing, so the firmware's path still wins over the Pod 3 default.
export function pickSockPath(configured, remoteDevMode, fromFirmware) {
    return configured || (remoteDevMode ? undefined : fromFirmware());
}
const FIRMWARE_MAP = {
    remoteDevMode: {
        dacLocation: `${process.env.DATA_FOLDER}/dac.sock`,
    },
    pod3FirmwareReset: {
        dacLocation: '/deviceinfo/dac.sock',
    },
    pod4FirmwareReset: {
        dacLocation: '/persistent/deviceinfo/dac.sock',
    },
};
class Config {
    // eslint-disable-next-line no-use-before-define
    static instance;
    dbFolder;
    lowDbFolder;
    remoteDevMode;
    dacSockPath;
    constructor() {
        if (!process.env.DATA_FOLDER || !process.env.ENV) {
            throw new Error('Missing DATA_FOLDER || ENV in env');
        }
        this.remoteDevMode = process.env.ENV === 'local';
        this.dacSockPath = this.detectSockPath();
        this.dbFolder = process.env.DATA_FOLDER;
        this.lowDbFolder = `${this.dbFolder}lowdb/`;
    }
    detectSockPath() {
        const dacSockPath = pickSockPath(checkIfDacSockPathConfigured(), this.remoteDevMode, sockPathFromFirmware);
        if (dacSockPath) {
            logger.debug(`'Custom dac.sock path configured, using ${dacSockPath}`);
            return dacSockPath;
        }
        else if (!this.remoteDevMode) {
            logger.debug('No dac.sock path configured, defaulting to pod 3 path');
            return FIRMWARE_MAP.pod3FirmwareReset.dacLocation;
        }
        else if (this.remoteDevMode) {
            return FIRMWARE_MAP.remoteDevMode.dacLocation;
        }
        else {
            throw new Error('Error - Did not detect device firmware');
        }
    }
    static getInstance() {
        if (!Config.instance) {
            Config.instance = new Config();
        }
        return Config.instance;
    }
}
export default Config.getInstance();
//# sourceMappingURL=config.js.map