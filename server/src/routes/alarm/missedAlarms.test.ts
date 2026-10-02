import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import express from 'express';

const folder = mkdtempSync(path.join(tmpdir(), 'nightstand-missed-alarms-route-'));
mkdirSync(path.join(folder, 'lowdb'));
process.env.DATA_FOLDER = `${folder}/`;
process.env.ENV = 'local';

const ledger = await import('../../jobs/alarmLedger.js');
const { default: router } = await import('./missedAlarms.js');
const app = express();
app.use(express.json());
app.use('/api/', router);
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

const request = async (method: string, route: string, body?: unknown) => {
  const response = await fetch(`${base}${route}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : undefined };
};

before(() => { ledger.startAlarmLedger(new Date()); });
after(async () => {
  ledger.resetAlarmLedgerForTests();
  await new Promise<void>(resolve => server.close(() => resolve()));
  rmSync(folder, { recursive: true, force: true });
});

describe('missed alarm routes', () => {
  it('lists missed alarms', async () => {
    ledger.noteMissedAlarm('left', new Date(Date.now() - 60_000), 'late');
    const response = await request('GET', '/api/alarms/missed');
    assert.equal(response.status, 200);
    assert.equal(response.body.missed.length, 1);
    assert.equal(response.body.missed[0].reason, 'late');
  });
  it('dismisses by id and rejects other shapes', async () => {
    const [item] = ledger.listMissedAlarms();
    assert.equal((await request('POST', '/api/alarms/missed/dismiss', { ids: [item.id] })).status, 204);
    assert.equal(ledger.listMissedAlarms().length, 0);
    assert.equal((await request('POST', '/api/alarms/missed/dismiss', { ids: 'x' })).status, 400);
    assert.equal((await request('POST', '/api/alarms/missed/dismiss', { ids: [], extra: 1 })).status, 400);
  });
});
