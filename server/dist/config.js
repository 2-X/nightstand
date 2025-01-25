import { existsSync, mkdirSync, readFileSync } from 'fs';
import logger from './logger.js';
function checkIfDacSockPathConfigured() {
    try {
        // Check if the file exists
        const filePath = '/home/dac/dac_sock_path.txt';
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
const FIRMWARE_MAP = {
    remoteDevMode: {
        dacLocation: 'lowdb/dac.sock',
    },
    pod3FirmwareReset: {
        dacLocation: '/deviceinfo/dac.sock',
    },
    pod4FirmwareReset: {
        dacLocation: '/persistent/deviceinfo/dac.sock',
    },
};
class Config {
    static instance;
    dbFolder;
    remoteDevMode;
    dacSockPath;
    constructor() {
        this.remoteDevMode = process.platform === 'darwin';
        this.dacSockPath = this.detectSockPath();
        this.dbFolder = this.remoteDevMode ? '~/free-sleep-database/' : '/home/dac/free-sleep-database/';
        this.initDBFolder();
    }
    initDBFolder() {
        if (!existsSync(this.dbFolder)) {
            try {
                logger.debug(`Creating DB folder: ${this.dbFolder}`);
                mkdirSync(this.dbFolder, { recursive: true });
            }
            catch (error) {
                console.error(`Failed to create folder: ${this.dbFolder}`, error);
            }
        }
    }
    detectSockPath() {
        const dacSockPath = checkIfDacSockPathConfigured();
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
