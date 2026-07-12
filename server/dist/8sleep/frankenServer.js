import { SequentialQueue } from './sequentialQueue.js';
import { MessageStream } from './messageStream.js';
import { frankenCommands } from './deviceApi.js';
import { UnixSocketServer } from './unixSocketServer.js';
import logger from '../logger.js';
import { loadDeviceStatus } from './loadDeviceStatus.js';
import config from '../config.js';
import { toPromise, wait } from './promises.js';
import { promiseWithTimeout } from './timeoutPromise.js';
import metrics from '../metrics/metrics.js';
const FRANKEN_CONNECTION_TIMEOUT_MS = 25_000;
const FRANKEN_COMMAND_TIMEOUT_MS = Number(process.env.FRANKEN_COMMAND_TIMEOUT_MS) || 5_000;
// Hard ceiling on a command's whole trip: queue wait + socket write + read.
// The per-command timeout above only covers the read, so it never fires for
// a command stuck waiting in the queue or blocked mid-write.
const FRANKEN_COMMAND_TOTAL_TIMEOUT_MS = Number(process.env.FRANKEN_COMMAND_TOTAL_TIMEOUT_MS) || 15_000;
class FrankenConnectionTimeoutError extends Error {
    constructor() {
        super('Timed out waiting for Franken hardware connection');
        this.name = 'FrankenConnectionTimeoutError';
    }
}
export class FrankenCommandTimeoutError extends Error {
    constructor(commandNumber, timeoutMs, detail) {
        super(`Franken command ${commandNumber} did not respond within ${timeoutMs}ms${detail ? ` (${detail})` : ''}`);
        this.name = 'FrankenCommandTimeoutError';
    }
}
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
        const commandNumber = message.split('\n', 1)[0] ?? '?';
        const startedAt = Date.now();
        let timedOut = false;
        let writeCompleted = false;
        try {
            const execPromise = this.sequentialQueue.exec(async () => {
                const requestBytes = Buffer.concat([Buffer.from(message), Franken.separator]);
                await this.write(requestBytes);
                writeCompleted = true;
                // Race the read against a per-command timeout. If the timeout fires
                // we abort the readMessage() listener (so it stops holding a slot in
                // the message stream) and surface a typed error.
                const abortController = new AbortController();
                const resp = await promiseWithTimeout(this.messageStream.readMessage({ signal: abortController.signal }), FRANKEN_COMMAND_TIMEOUT_MS, {
                    abortController,
                    onTimeout: () => new FrankenCommandTimeoutError(commandNumber, FRANKEN_COMMAND_TIMEOUT_MS),
                });
                if (Franken.responseDelayMs > 0) {
                    await wait(10);
                }
                return resp;
            });
            // If the total deadline below fires, nothing awaits execPromise anymore.
            // Swallow its eventual settlement so an abandoned task can't surface as
            // an unhandled rejection (which triggers a graceful shutdown).
            execPromise.catch(() => undefined);
            // The read timeout inside the task only starts after the write has
            // completed. A command stuck in the queue or wedged mid-write would
            // otherwise hang its caller forever with no timeout and no log line
            // (observed in production: every /deviceStatus request after a fresh
            // Franken connect hung silently until the deploy health check gave up).
            // The deadline error notes where the command got stuck.
            const responseBytes = await promiseWithTimeout(execPromise, FRANKEN_COMMAND_TOTAL_TIMEOUT_MS, {
                onTimeout: () => new FrankenCommandTimeoutError(commandNumber, FRANKEN_COMMAND_TOTAL_TIMEOUT_MS, `total deadline; queue depth ${this.sequentialQueue.depth()}, write ${writeCompleted ? 'completed' : 'never completed'}`),
            });
            metrics.recordFrankenCommand(Date.now() - startedAt, false);
            const response = responseBytes.toString();
            logger.debug(`Message sent successfully to sock | message: ${message}`);
            return response;
        }
        catch (error) {
            if (error instanceof FrankenCommandTimeoutError) {
                timedOut = true;
                metrics.recordFrankenCommand(Date.now() - startedAt, true);
                logger.warn(`${error.message}; tearing down dac.sock so the next call reconnects`);
                // Fire-and-forget the reconnect so the rejected caller can handle the
                // error promptly. The next caller will rebuild the connection.
                // eslint-disable-next-line no-use-before-define
                void disconnectFranken().catch(err => logger.error(`disconnect after timeout failed: ${err}`));
            }
            if (!timedOut) {
                metrics.recordFrankenCommand(Date.now() - startedAt, false);
            }
            throw error;
        }
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
function waitForFrankenWithTimeout(server) {
    if (!FRANKEN_CONNECTION_TIMEOUT_MS) {
        return server.waitForFranken();
    }
    const timeoutMessage = `Restarting Franken after ${FRANKEN_CONNECTION_TIMEOUT_MS / 1_000}s timeout`;
    return promiseWithTimeout(server.waitForFranken(), FRANKEN_CONNECTION_TIMEOUT_MS, {
        onTimeout: () => {
            logger.warn(timeoutMessage);
            return new FrankenConnectionTimeoutError();
        },
    });
}
async function shutdownFrankenServer() {
    // Grab and null out the module-level singletons synchronously, before any
    // await. This can run concurrently with itself, e.g. the connect-retry
    // loop calling this after a connection timeout at the same moment
    // gracefulShutdown() calls disconnectFranken() from a SIGTERM, and the
    // old code re-checked franken/frankenServer after an await, so one caller
    // could null a reference out from under the other mid-close, producing
    // "Cannot read properties of undefined (reading 'close')". Capturing
    // locals up front makes a concurrent call see both as already cleared and
    // become a no-op instead of racing.
    const currentFranken = franken;
    const currentFrankenServer = frankenServer;
    franken = undefined;
    frankenServer = undefined;
    if (currentFranken) {
        try {
            await currentFranken.sequentialQueue.drain();
        }
        catch {
            // ignored
        }
        currentFranken.close();
    }
    if (currentFrankenServer) {
        await currentFrankenServer.close();
    }
}
export async function connectFranken() {
    if (franken)
        return franken;
    if (connectPromise)
        return connectPromise;
    connectPromise = (async () => {
        // eslint-disable-next-line no-constant-condition
        while (true) {
            if (!frankenServer) {
                frankenServer = await FrankenServer.start(config.dacSockPath);
                logger.debug('FrankenServer started');
            }
            try {
                logger.debug('Waiting for Franken hardware connection...');
                franken = await waitForFrankenWithTimeout(frankenServer);
                logger.info('Franken socket connected');
                return franken;
            }
            catch (error) {
                if (error instanceof FrankenConnectionTimeoutError) {
                    logger.warn('Unable to connect to Franken within timeout, restarting socket server...');
                    await shutdownFrankenServer();
                    continue;
                }
                await shutdownFrankenServer();
                throw error;
            }
        }
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
    await shutdownFrankenServer();
}
export function getFrankenQueueDepth() {
    return franken?.sequentialQueue.depth() ?? 0;
}
export function isFrankenConnected() {
    return franken !== undefined;
}
// Concurrent callers asking for device status share a single roundtrip while
// one is in flight. Cache lifetime is the duration of the in-flight call only,
// no stale reads, this is purely a "did N requests just arrive simultaneously"
// optimisation. Failures (including timeouts) are not cached.
let inFlightDeviceStatus;
export async function getDeviceStatusCoalesced(getGestures = false) {
    if (inFlightDeviceStatus)
        return inFlightDeviceStatus;
    const f = await connectFranken();
    inFlightDeviceStatus = f.getDeviceStatus(getGestures).finally(() => {
        inFlightDeviceStatus = undefined;
    });
    return inFlightDeviceStatus;
}
//# sourceMappingURL=frankenServer.js.map