import assert from 'node:assert/strict';
import { describe, it, before } from 'node:test';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
// config.ts throws if these aren't set, and reading it is what sets
// lowDbFolder for the db module under test. Must run before the dynamic
// import below. A fresh temp dir keeps this test isolated from any real
// settingsDB.json on the machine running it.
const dataFolder = mkdtempSync(path.join(tmpdir(), 'free-sleep-logs-test-'));
mkdirSync(path.join(dataFolder, 'lowdb'));
process.env.DATA_FOLDER = `${dataFolder}/`;
process.env.ENV = 'local';
let settingsDB;
let requireLogsViewerEnabled;
before(async () => {
    ({ default: settingsDB } = await import('../../db/settings.js'));
    ({ requireLogsViewerEnabled } = await import('./logs.js'));
});
function mockRes() {
    const calls = {};
    const res = {
        status(code) {
            calls.status = code;
            return res;
        },
        json(body) {
            calls.body = body;
            return res;
        },
    };
    return { res, calls };
}
describe('requireLogsViewerEnabled', () => {
    it('403s and does not call next when the flag is off', async () => {
        settingsDB.data.features.logsViewer = false;
        await settingsDB.write();
        const { res, calls } = mockRes();
        let nextCalled = false;
        await requireLogsViewerEnabled({}, res, (() => { nextCalled = true; }));
        assert.equal(calls.status, 403);
        assert.equal(nextCalled, false);
    });
    it('calls next without responding when the flag is on', async () => {
        settingsDB.data.features.logsViewer = true;
        await settingsDB.write();
        const { res, calls } = mockRes();
        let nextCalled = false;
        await requireLogsViewerEnabled({}, res, (() => { nextCalled = true; }));
        assert.equal(calls.status, undefined);
        assert.equal(nextCalled, true);
    });
});
//# sourceMappingURL=logs.test.js.map