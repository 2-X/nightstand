import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const folder = mkdtempSync(path.join(tmpdir(), 'nightstand-persistence-'));
mkdirSync(path.join(folder, 'lowdb'));
process.env.DATA_FOLDER = `${folder}/`;
process.env.ENV = 'local';
const { default: settings } = await import('../db/settings.js');
const { default: schedules } = await import('../db/schedules.js');
const { default: settingsRouter } = await import('./settings/settings.js');
const { default: schedulesRouter } = await import('./schedules/schedules.js');
const app = express();
app.use(express.json(), settingsRouter, schedulesRouter);
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
after(async () => {
    await new Promise(resolve => server.close(() => resolve()));
    rmSync(folder, { recursive: true, force: true });
});
async function post(route, body) {
    const response = await fetch(`${url}/${route}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    await response.text();
    assert.equal(response.status, 200);
}
test('concurrent settings saves preserve both sides despite readers', async () => {
    let lost = 0;
    for (let round = 0; round < 20; round++) {
        settings.data.left.name = 'Before left';
        settings.data.right.name = 'Before right';
        await settings.write();
        await Promise.all([
            post('settings', { left: { name: 'After left' } }),
            post('settings', { right: { name: 'After right' } }),
            fetch(`${url}/settings`).then(response => response.text()),
        ]);
        await settings.read();
        if (settings.data.left.name !== 'After left' || settings.data.right.name !== 'After right')
            lost++;
    }
    assert.equal(lost, 0, 'a successful concurrent save was lost');
});
test('concurrent schedule patches preserve both sides despite readers', async () => {
    let lost = 0;
    for (let round = 0; round < 20; round++) {
        schedules.data.left.monday.power.onTemperature = 70;
        schedules.data.right.monday.power.onTemperature = 70;
        await schedules.write();
        await Promise.all([
            post('schedules', { left: { monday: { power: { onTemperature: 80 } } } }),
            post('schedules', { right: { monday: { power: { onTemperature: 90 } } } }),
            fetch(`${url}/schedules`).then(response => response.text()),
        ]);
        await schedules.read();
        if (schedules.data.left.monday.power.onTemperature !== 80 || schedules.data.right.monday.power.onTemperature !== 90)
            lost++;
    }
    assert.equal(lost, 0, 'a successful concurrent schedule save was lost');
});
//# sourceMappingURL=persistenceConcurrency.test.js.map