
!function(){try{var e="undefined"!=typeof window?window:"undefined"!=typeof global?global:"undefined"!=typeof globalThis?globalThis:"undefined"!=typeof self?self:{},n=(new e.Error).stack;n&&(e._sentryDebugIds=e._sentryDebugIds||{},e._sentryDebugIds[n]="2851f4d6-1201-5522-89b7-8cbbdb8a34b2")}catch(e){}}();
import { SequentialQueue } from './sequentialQueue.js';
import { MessageStream } from './messageStream.js';
import { frankenCommands } from './deviceApi.js';
import { UnixSocketServer } from './unixSocketServer.js';
import logger from '../logger.js';
import { loadDeviceStatus } from './loadDeviceStatus.js';
import config from '../config.js';
import { toPromise, wait } from './promises.js';
export class Franken {
    socket;
    messageStream;
    sequentialQueue;
    static responseDelayMs = 10;
    constructor(socket, messageStream, sequentialQueue) {
        this.socket = socket;
        this.messageStream = messageStream;
        this.sequentialQueue = sequentialQueue;
    }
    static separator = Buffer.from('\n\n');
    async sendMessage(message) {
        logger.debug(`Sending message to sock | message: ${message}`);
        const responseBytes = await this.sequentialQueue.exec(async () => {
            const requestBytes = Buffer.concat([Buffer.from(message), Franken.separator]);
            await this.write(requestBytes);
            const resp = await this.messageStream.readMessage();
            if (Franken.responseDelayMs > 0) {
                await wait(10);
            }
            return resp;
        });
        const response = responseBytes.toString();
        logger.debug(`Message sent successfully to sock | message: ${message}`);
        return response;
    }
    tryStripNewlines(arg) {
        const containsNewline = arg.indexOf('\n') >= 0;
        if (!containsNewline)
            return arg;
        return arg.replace(/\n/gm, '');
    }
    async callFunction(command, arg) {
        logger.debug(`Calling function | command: ${command} | arg: ${arg}`);
        const commandNumber = frankenCommands[command];
        const cleanedArg = this.tryStripNewlines(arg);
        logger.debug(`commandNumber: ${commandNumber}`);
        logger.debug(`cleanedArg: ${cleanedArg}`);
        await this.sendMessage(`${commandNumber}\n${cleanedArg}`);
    }
    async getDeviceStatus(getGestures = false) {
        const command = 'DEVICE_STATUS';
        const commandNumber = frankenCommands[command];
        const response = await this.sendMessage(commandNumber);
        return await loadDeviceStatus(response, getGestures);
    }
    close() {
        const socket = this.socket;
        if (!socket.destroyed)
            socket.destroy();
    }
    static fromSocket(socket) {
        const messageStream = new MessageStream(socket, Franken.separator);
        return new Franken(socket, messageStream, new SequentialQueue());
    }
    async write(data) {
        // @ts-expect-error
        await toPromise(cb => this.socket.write(data, cb));
    }
}
class FrankenServer {
    server;
    constructor(server) {
        this.server = server;
    }
    async close() {
        logger.debug('Closing FrankenServer socket...');
        await this.server.close();
    }
    async waitForFranken() {
        const socket = await this.server.waitForConnection();
        logger.debug('FrankenServer connected');
        return Franken.fromSocket(socket);
    }
    static async start(path) {
        logger.debug(`Creating franken server on socket: ${config.dacSockPath}`);
        const unixSocketServer = await UnixSocketServer.start(path);
        return new FrankenServer(unixSocketServer);
    }
}
let frankenServer;
let franken;
let connectPromise;
export async function connectFranken() {
    if (franken)
        return franken;
    if (connectPromise)
        return connectPromise;
    connectPromise = (async () => {
        if (!frankenServer) {
            frankenServer = await FrankenServer.start(config.dacSockPath);
            logger.debug('FrankenServer started');
        }
        logger.debug('Waiting for Franken hardware connection...');
        franken = await frankenServer.waitForFranken();
        logger.info('Franken socket connected');
        return franken;
    })();
    try {
        return await connectPromise;
    }
    finally {
        connectPromise = undefined;
    }
}
export async function disconnectFranken() {
    connectPromise = undefined;
    franken?.close();
    franken = undefined;
    if (frankenServer) {
        await frankenServer.close();
        frankenServer = undefined;
    }
}
//# sourceMappingURL=frankenServer.js.map
//# debugId=2851f4d6-1201-5522-89b7-8cbbdb8a34b2
