import _ from 'lodash';
import { connectFranken } from './frankenServer.js';
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
    // Documented by the 8rp reverse-engineering project
    // (https://github.com/Schluggi/8rp/blob/main/docs/commands.md) as
    // STOP_PRIME. Tested live against a pod: sent with the default 'empty'
    // arg both before and after priming was confirmed active, isPriming
    // stayed true for 5+ minutes afterward, it did not visibly interrupt an
    // active priming cycle. Kept mapped since it's still useful to have the
    // command name on record and it may need a different arg or only apply
    // in some other context; the UI no longer exposes a Cancel action built
    // on it. See docs/EIGHT_SLEEP_PROTOCOL.md.
    STOP_PRIME: '17',
};
export const invertedFrankenCommands = _.invert(frankenCommands);
export async function executeFunction(command, arg = 'empty') {
    logger.debug(`Executing command | command: ${command} | arg: ${arg}`);
    const franken = await connectFranken();
    // const frankenCommand = funcNameToFrankenCommand[name];
    // if franken disconnects right before a function call this will throw
    // the error will bubble up to the main loop of the device-api-client (protocol handling)
    // and the client will crash disconnecting from device-api - this is safe, it's correctly cleaned-up,
    // deviceApiLoop will take care of reconnecting to device-api
    const response = await franken.callFunction(command, arg);
    logger.debug(response);
    return response;
}
//# sourceMappingURL=deviceApi.js.map