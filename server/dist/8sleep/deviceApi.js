import _ from 'lodash';
import { connectFrankenWithin } from './frankenServer.js';
import logger from '../logger.js';
export const frankenCommands = {
    HELLO: '0',
    SET_TEMP: '1',
    SET_ALARM: '2',
    // RESET: '3',
    // FORCE_RESET: '4',
    ALARM_LEFT: '5',
    ALARM_RIGHT: '6',
    // FORMAT: '7',
    SET_SETTINGS: '8',
    LEFT_TEMP_DURATION: '9',
    RIGHT_TEMP_DURATION: '10',
    TEMP_LEVEL_LEFT: '11',
    TEMP_LEVEL_RIGHT: '12',
    PRIME: '13',
    DEVICE_STATUS: '14',
    ALARM_CLEAR: '16',
};
export const invertedFrankenCommands = _.invert(frankenCommands);
// A function arg is worked out once the Pod is reachable, for values that
// depend on when the command is sent.
export async function executeFunction(command, arg = 'empty', options = {}) {
    logger.debug(`Executing command | command: ${command} | arg: ${typeof arg === 'string' ? arg : 'when sent'}`);
    const franken = await connectFrankenWithin(options, command);
    // const frankenCommand = funcNameToFrankenCommand[name];
    // if franken disconnects right before a function call this will throw
    // the error will bubble up to the main loop of the device-api-client (protocol handling)
    // and the client will crash disconnecting from device-api - this is safe, it's correctly cleaned-up,
    // deviceApiLoop will take care of reconnecting to device-api
    const response = await franken.callFunction(command, typeof arg === 'string' ? arg : arg());
    logger.debug(response);
    return response;
}
//# sourceMappingURL=deviceApi.js.map