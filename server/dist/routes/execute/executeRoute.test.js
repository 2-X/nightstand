import assert from 'node:assert/strict';
import { after, beforeEach, describe, it, mock } from 'node:test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
const folder = mkdtempSync(path.join(tmpdir(), 'nightstand-execute-route-'));
mkdirSync(path.join(folder, 'lowdb'));
process.env.DATA_FOLDER = `${folder}/`;
process.env.ENV = 'local';
const { frankenCommands } = await import('../../8sleep/deviceApi.js');
const sent = [];
mock.module(new URL('../../8sleep/deviceApi.js', import.meta.url).href, {
    namedExports: {
        frankenCommands,
        executeFunction: async (command, arg) => { sent.push([command, arg]); },
    },
});
const { default: router } = await import('./execute.js');
const app = express();
app.use(express.json(), router);
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const url = `http://127.0.0.1:${server.address().port}/execute`;
after(async () => {
    await new Promise(resolve => server.close(() => resolve()));
    rmSync(folder, { recursive: true, force: true });
});
const post = async (body) => {
    const response = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    return { status: response.status, type: response.headers.get('content-type'), body: await response.json() };
};
beforeEach(() => { sent.length = 0; });
describe('POST /execute', () => {
    it('answers an unknown command with a JSON message', async () => {
        const response = await post({ command: 'NOPE' });
        assert.equal(response.status, 400);
        assert.match(response.type ?? '', /application\/json/);
        assert.deepEqual(response.body, { message: 'Invalid command' });
        assert.deepEqual(sent, []);
    });
    for (const command of ['STOP_PRIME', 'ALARM_SOLO', '17']) {
        it(`refuses disputed command ${command} without sending it`, async () => {
            const response = await post({ command, arg: 'empty' });
            assert.equal(response.status, 400);
            assert.deepEqual(response.body, { message: 'Invalid command' });
            assert.deepEqual(sent, []);
        });
    }
    it('answers an out of range arg with a JSON message', async () => {
        const response = await post({ command: 'TEMP_LEVEL_LEFT', arg: '1e2' });
        assert.equal(response.status, 400);
        assert.deepEqual(response.body, { message: 'Invalid arg for TEMP_LEVEL_LEFT' });
        assert.deepEqual(sent, []);
    });
    it('runs a valid command', async () => {
        const response = await post({ command: 'PRIME' });
        assert.equal(response.status, 200);
        assert.deepEqual(sent, [['PRIME', 'empty']]);
    });
});
//# sourceMappingURL=executeRoute.test.js.map