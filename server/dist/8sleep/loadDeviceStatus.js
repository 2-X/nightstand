import { z } from 'zod';
import logger from '../logger.js';
import memoryDB from '../db/memoryDB.js';
const RawDeviceData = z.object({
    tgHeatLevelR: z.string().regex(/^-?\d+$/, { message: 'tgHeatLevelR must be a numeric value in a string' }),
    tgHeatLevelL: z.string().regex(/^-?\d+$/, { message: 'tgHeatLevelL must be a numeric value in a string' }),
    heatTimeL: z.string().regex(/^\d+$/, { message: 'heatTimeL must be a positive numeric value in a string' }),
    heatLevelL: z.string().regex(/^-?\d+$/, { message: 'heatLevelL must be a numeric value in a string' }),
    heatTimeR: z.string().regex(/^\d+$/, { message: 'heatTimeR must be a positive numeric value in a string' }),
    heatLevelR: z.string().regex(/^-?\d+$/, { message: 'heatLevelR must be a numeric value in a string' }),
    sensorLabel: z.string(),
    waterLevel: z.string().regex(/^(true|false)$/, { message: 'waterLevel must be "true" or "false"' }),
    priming: z.string().regex(/^(true|false)$/, { message: 'priming must be "true" or "false"' }),
    settings: z.string(),
});
// Reads & validates the raw response data from socket and converts it to an object
const parseRawDeviceData = (response) => {
    const rawDeviceData = Object.fromEntries(response.split('\n').map(l => l.split(' = ')));
    try {
        RawDeviceData.parse(rawDeviceData);
        return rawDeviceData;
    }
    catch (error) {
        logger.error(error);
        throw error;
    }
};
// Scale goes from -100 < - > 100
// Low  -> 55
// High -> 110
// 0 -> 82.5f
// -100 -> 55f
// 100 -> 110f
const calculateTempInF = (value) => {
    const level = Number(value);
    if (level === 0) {
        // Technically 0 is 82.5, rounding the temperature simplifies everything though...
        return 83;
    }
    else if (level < 0) {
        return Math.round(82.5 - (-1 * level / 100) * 27.5);
    }
    else {
        return Math.round(82.5 + (level / 100) * 27.5);
    }
};
// The default naming convention was ugly... This remaps the keys to human-readable names
export async function loadDeviceStatus(response) {
    const rawDeviceData = parseRawDeviceData(response);
    const leftSideSecondsRemaining = Number(rawDeviceData.heatTimeL);
    const rightSideSecondsRemaining = Number(rawDeviceData.heatTimeR);
    await memoryDB.read();
    return {
        left: {
            currentTemperatureF: calculateTempInF(rawDeviceData.heatLevelL),
            targetTemperatureF: calculateTempInF(rawDeviceData.tgHeatLevelL),
            secondsRemaining: leftSideSecondsRemaining,
            isOn: leftSideSecondsRemaining > 0,
            isAlarmVibrating: memoryDB.data.left.isAlarmVibrating,
        },
        right: {
            currentTemperatureF: calculateTempInF(rawDeviceData.heatLevelR),
            targetTemperatureF: calculateTempInF(rawDeviceData.tgHeatLevelR),
            secondsRemaining: rightSideSecondsRemaining,
            isOn: rightSideSecondsRemaining > 0,
            isAlarmVibrating: memoryDB.data.right.isAlarmVibrating,
        },
        sensorLabel: rawDeviceData.sensorLabel,
        waterLevel: rawDeviceData.waterLevel,
        isPriming: rawDeviceData.priming === 'true',
        settings: rawDeviceData.settings,
    };
}
