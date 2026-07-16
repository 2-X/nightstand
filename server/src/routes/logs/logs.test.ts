import assert from 'node:assert/strict';
import { describe, it, before } from 'node:test';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Request, Response, NextFunction } from 'express';

// config.ts throws if these aren't set, and reading it is what sets
// lowDbFolder for the db module under test. Must run before the dynamic
// import below. A fresh temp dir keeps this test isolated from any real
// settingsDB.json on the machine running it.
const dataFolder = mkdtempSync(path.join(tmpdir(), 'free-sleep-logs-test-'));
mkdirSync(path.join(dataFolder, 'lowdb'));
process.env.DATA_FOLDER = `${dataFolder}/`;
process.env.ENV = 'local';

let settingsDB: typeof import('../../db/settings.js')['default'];
let requireLogsViewerEnabled: typeof import('./logs.js')['requireLogsViewerEnabled'];

before(async () => {
  ({ default: settingsDB } = await import('../../db/settings.js'));
  ({ requireLogsViewerEnabled } = await import('./logs.js'));
});

function mockRes() {
  const calls: { status?: number; body?: unknown } = {};
  const res = {
    status(code: number) {
      calls.status = code;
      return res;
    },
    json(body: unknown) {
      calls.body = body;
      return res;
    },
  } as unknown as Response;
  return { res, calls };
}

describe('requireLogsViewerEnabled', () => {
  it('403s and does not call next when the flag is off', async () => {
    settingsDB.data.features.logsViewer = false;
    await settingsDB.write();
    const { res, calls } = mockRes();
    let nextCalled = false;
    await requireLogsViewerEnabled({} as Request, res, (() => { nextCalled = true; }) as NextFunction);
    assert.equal(calls.status, 403);
    assert.equal(nextCalled, false);
  });

  it('calls next without responding when the flag is on', async () => {
    settingsDB.data.features.logsViewer = true;
    await settingsDB.write();
    const { res, calls } = mockRes();
    let nextCalled = false;
    await requireLogsViewerEnabled({} as Request, res, (() => { nextCalled = true; }) as NextFunction);
    assert.equal(calls.status, undefined);
    assert.equal(nextCalled, true);
  });
});
