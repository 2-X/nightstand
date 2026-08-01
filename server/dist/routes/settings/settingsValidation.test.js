import assert from 'node:assert/strict';
import { describe, it, before, after } from 'node:test';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import express from 'express';
import moment from 'moment-timezone';
// Isolated DATA_FOLDER, set before the dynamic imports (config.ts reads it at
// import time). Same pattern as jobs/scheduleOverride.test.ts.
const dataFolder = mkdtempSync(path.join(tmpdir(), 'nightstand-settings-validation-'));
mkdirSync(path.join(dataFolder, 'lowdb'));
process.env.DATA_FOLDER = `${dataFolder}/`;
process.env.ENV = 'local';
let settingsRouter;
let server;
let baseUrl;
before(async () => {
    ({ default: settingsRouter } = await import('./settings.js'));
    const app = express();
    app.use(express.json());
    app.use(settingsRouter);
    server = createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
    await new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
    });
});
const postSettings = async (body) => {
    const res = await fetch(`${baseUrl}/settings`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
};
const futureIso = () => moment().add(1, 'hour').format();
const postAlarmOverride = (timeOverride, expiresAt = futureIso()) => postSettings({
    left: { scheduleOverrides: { alarm: { disabled: false, timeOverride, expiresAt } } },
});
describe('POST /settings alarm timeOverride validation', () => {
    it('rejects an out-of-range HH:mm alarm timeOverride', async () => {
        const res = await postAlarmOverride('25:00');
        assert.equal(res.status, 400, `expected 400, got ${res.status}`);
    });
    it('rejects a non-time alarm timeOverride', async () => {
        const res = await postAlarmOverride('tomorrow morning');
        assert.equal(res.status, 400, `expected 400, got ${res.status}`);
    });
    it('accepts a valid HH:mm alarm timeOverride', async () => {
        const res = await postAlarmOverride('07:00');
        assert.equal(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    });
    it('accepts an empty timeOverride, which is how the UI clears an override', async () => {
        const res = await postAlarmOverride('', '');
        assert.equal(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    });
});
describe('POST /settings expiresAt validation', () => {
    it('rejects a non-parseable alarm expiresAt', async () => {
        const res = await postAlarmOverride('07:00', 'not a date');
        assert.equal(res.status, 400, `expected 400, got ${res.status}`);
    });
    it('rejects a non-parseable temperature schedule expiresAt', async () => {
        const res = await postSettings({
            left: { scheduleOverrides: { temperatureSchedules: { disabled: true, expiresAt: 'soon' } } },
        });
        assert.equal(res.status, 400, `expected 400, got ${res.status}`);
    });
    it('accepts the offset-bearing ISO string the server itself writes', async () => {
        const res = await postSettings({
            left: { scheduleOverrides: { temperatureSchedules: { disabled: true, expiresAt: futureIso() } } },
        });
        assert.equal(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    });
});
describe('POST /settings one-off alarm fireAt validation', () => {
    const oneOffAlarm = (fireAt) => postSettings({
        left: {
            oneOffAlarm: {
                enabled: true, fireAt, vibrationIntensity: 50, vibrationPattern: 'rise', duration: 60,
            },
        },
    });
    it('rejects a non-ISO fireAt', async () => {
        const res = await oneOffAlarm('whenever');
        assert.equal(res.status, 400, `expected 400, got ${res.status}`);
    });
    it('rejects an HH:mm fireAt, which is not a datetime', async () => {
        const res = await oneOffAlarm('07:00');
        assert.equal(res.status, 400, `expected 400, got ${res.status}`);
    });
    it('accepts an ISO fireAt', async () => {
        const res = await oneOffAlarm(futureIso());
        assert.equal(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    });
    it('accepts an empty fireAt, the stored unset value', async () => {
        const res = await oneOffAlarm('');
        assert.equal(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    });
});
//# sourceMappingURL=settingsValidation.test.js.map