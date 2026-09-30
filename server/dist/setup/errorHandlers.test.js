import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
const folder = mkdtempSync(path.join(tmpdir(), 'nightstand-error-handlers-'));
mkdirSync(path.join(folder, 'lowdb'));
process.env.DATA_FOLDER = `${folder}/`;
process.env.ENV = 'local';
const { FrankenCommandTimeoutError, FrankenUnavailableError } = await import('../8sleep/frankenServer.js');
const { registerErrorHandlers } = await import('./errorHandlers.js');
const app = express();
app.use(express.json({ limit: '1kb' }));
app.post('/unavailable', () => { throw new FrankenUnavailableError(); });
app.post('/timeout', () => { throw new FrankenCommandTimeoutError('11', 5_000); });
app.post('/echo', (req, res) => { res.json(req.body); });
app.get('/database', () => { throw new Error('Invalid `prisma.vitals.findMany()` invocation: Argument `gte` is missing.'); });
app.get('/teapot', () => { throw Object.assign(new Error('Short and stout'), { status: 418 }); });
registerErrorHandlers(app);
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
after(async () => {
    await new Promise(resolve => server.close(() => resolve()));
    rmSync(folder, { recursive: true, force: true });
});
const post = async (route, body = '{}') => {
    const response = await fetch(`${base}${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    return { status: response.status, body: await response.json() };
};
test('a command without a hardware connection answers 503', async () => {
    const response = await post('/unavailable');
    assert.equal(response.status, 503);
    assert.match(response.body.error.message, /not connected/);
});
test('a command the hardware did not answer answers 503', async () => {
    const response = await post('/timeout');
    assert.equal(response.status, 503);
    assert.match(response.body.error.message, /did not respond/);
});
test('malformed JSON still answers 400', async () => {
    const response = await post('/echo', '{');
    assert.equal(response.status, 400);
    assert.equal(response.body.error.message, 'Invalid JSON');
});
test('an unexpected error answers a generic 500 without internals', async () => {
    const response = await fetch(`${base}/database`);
    const body = await response.json();
    assert.equal(response.status, 500);
    assert.equal(body.error.message, 'Internal Server Error');
    assert.equal(body.error.stack, undefined);
});
test('a client error keeps its message', async () => {
    const teapot = await fetch(`${base}/teapot`);
    assert.equal(teapot.status, 418);
    assert.equal((await teapot.json()).error.message, 'Short and stout');
    const tooLarge = await post('/echo', JSON.stringify({ padding: 'x'.repeat(2_000) }));
    assert.equal(tooLarge.status, 413);
    assert.equal(tooLarge.body.error.message, 'request entity too large');
    assert.equal(tooLarge.body.error.stack, undefined);
});
//# sourceMappingURL=errorHandlers.test.js.map