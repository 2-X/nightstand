import { createServer } from 'net';
import { unlink as unlinkCb } from 'fs';
import logger from '../logger.js';
import { toPromise } from './promises.js';
async function unlink(path) {
    // @ts-ignore
    await toPromise((cb) => unlinkCb(path, cb));
}
export class UnixSocketServer {
    server;
    lastConnection;
    resolveWaiting;
    constructor(server) {
        this.server = server;
        this.server.on('connection', this.onConnection.bind(this));
    }
    cleanupExistingConnection() {
        const existingConnection = this.lastConnection;
        if (existingConnection !== undefined) {
            this.lastConnection = undefined;
            existingConnection.destroy();
        }
    }
    onConnection(socket) {
        this.cleanupExistingConnection();
        if (this.resolveWaiting !== undefined) {
            logger.debug('Resolving connection waiting promise');
            const resolveWaiting = this.resolveWaiting;
            this.resolveWaiting = undefined;
            resolveWaiting(socket);
        }
        else {
            this.lastConnection = socket;
        }
    }
    async close() {
        // @ts-ignore
        await toPromise((cb) => this.server.close(cb));
    }
    waitForConnection() {
        if (this.lastConnection !== undefined) {
            logger.debug('Returning existing connection');
            const connection = this.lastConnection;
            this.lastConnection = undefined;
            return Promise.resolve(connection);
        }
        logger.debug('Waiting for future connection');
        return new Promise(resolve => this.resolveWaiting = resolve);
    }
    static async start(path) {
        logger.debug('Creating socket connection...');
        await UnixSocketServer.tryCleanup(path);
        const unixSocketServer = createServer();
        unixSocketServer.on('error', (error) => logger.error({ error: error, message: 'Unix socket server error' }));
        await new Promise((resolve) => unixSocketServer.listen(path, resolve));
        const socket = new UnixSocketServer(unixSocketServer);
        logger.debug('Created socket connection!');
        return socket;
    }
    static async tryCleanup(path) {
        try {
            await unlink(path);
        }
        catch (err) {
            // ignore if the path doesn't exist
            if (err?.code === 'ENOENT')
                return;
            throw err;
        }
    }
}
