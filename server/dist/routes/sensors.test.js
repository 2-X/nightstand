import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import express from 'express';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const folder = mkdtempSync(path.join(tmpdir(), 'sensor-route-test-'));
mkdirSync(path.join(folder, 'lowdb'));
process.env.DATA_FOLDER = `${folder}/`;
process.env.ENV = 'local';
const rows = [];
mock.module(new URL('../db/prisma.js', import.meta.url).href, { namedExports: { prisma: {
            vitals: { findFirst: async () => null },
            sensor_samples: {
                upsert: async ({ create }) => { rows.push(create); },
                deleteMany: async () => ({ count: 0 }),
                findMany: async () => rows,
            },
        } } });
test('sensor API stores source timestamps, rejects replay, and labels missing metrics', async () => {
    const { default: router } = await import('./sensors.js');
    const app = express();
    app.use(express.json());
    app.use('/api', router);
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/sensors`;
    try {
        const at = Math.floor(Date.now() / 1000) - 2;
        const payload = { kind: 'frzTemp', at, fields: { ambC: 22, leftC: null } };
        const post = () => fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        assert.equal((await post()).status, 204);
        assert.equal((await post()).status, 409);
        assert.equal(rows.length, 1);
        assert.equal(rows[0].timestamp, at);
        const response = await fetch(base);
        const state = await response.json();
        assert.equal(response.headers.get('cache-control'), 'private, no-store');
        assert.equal(state.vitals[0].hrv, 'unavailable');
        assert.equal(state.ready.left, false);
        assert.equal((await fetch(`${base}/history?kind=frzTemp&start=0&end=999999`)).status, 400);
        const history = await (await fetch(`${base}/history?kind=frzTemp&start=${at - 60}&end=${at + 1}`)).json();
        assert.equal(history[0].at, at);
    }
    finally {
        server.closeAllConnections();
        await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
});
//# sourceMappingURL=sensors.test.js.map