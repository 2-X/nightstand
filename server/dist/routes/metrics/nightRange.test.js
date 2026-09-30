import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const folder = mkdtempSync(path.join(tmpdir(), 'nightstand-night-range-'));
mkdirSync(path.join(folder, 'lowdb'));
process.env.DATA_FOLDER = `${folder}/`;
process.env.ENV = 'local';
const { default: stages } = await import('./sleepStages.js');
const { default: score } = await import('./sleepScore.js');
const app = express();
app.use(stages, score);
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
after(async () => {
    await new Promise(resolve => server.close(() => resolve()));
    rmSync(folder, { recursive: true, force: true });
});
test('stages and scores refuse ranges that would exhaust memory', async () => {
    const query = 'side=left&startTime=2026-09-27T20:00:00-07:00&endTime=9999-12-31T00:00:00Z';
    for (const route of ['/sleep-stages', '/sleep-score']) {
        const response = await fetch(`${base}${route}?${query}`);
        assert.equal(response.status, 400, route);
    }
});
test('stages and scores refuse malformed times instead of failing in the database', async () => {
    for (const route of ['/sleep-stages', '/sleep-score']) {
        const response = await fetch(`${base}${route}?side=left&startTime=garbage&endTime=2026-09-29T05:44:00-07:00`);
        assert.equal(response.status, 400, route);
    }
});
//# sourceMappingURL=nightRange.test.js.map