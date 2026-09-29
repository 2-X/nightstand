import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toPromise, wait } from './promises.js';
test('callback completion resolves the supplied value', async () => {
    const value = { connected: true };
    assert.equal(await toPromise(done => done(null, value)), value);
    assert.equal(await toPromise(done => done(null)), undefined);
});
test('callback errors and synchronous throws reject with the original error', async () => {
    const error = new Error('Connection closed');
    await assert.rejects(toPromise(done => done(error)), caught => caught === error);
    await assert.rejects(toPromise(() => { throw error; }), caught => caught === error);
});
test('only the first callback completion determines the result', async () => {
    assert.equal(await toPromise(done => {
        done(null, 'first');
        done(new Error('Late error'));
        done(null, 'last');
    }), 'first');
});
test('wait remains pending until its requested delay elapses', async (context) => {
    context.mock.timers.enable({ apis: ['setTimeout'] });
    let resolved = false;
    const pending = wait(2000).then(() => { resolved = true; });
    context.mock.timers.tick(1999);
    await Promise.resolve();
    assert.equal(resolved, false);
    context.mock.timers.tick(1);
    await pending;
    assert.equal(resolved, true);
});
test('cancel completes a pending wait without advancing the clock', async (context) => {
    context.mock.timers.enable({ apis: ['setTimeout'] });
    const pending = wait(60_000);
    pending.cancel();
    pending.cancel();
    assert.equal(await pending, undefined);
    context.mock.timers.tick(60_000);
    assert.equal(await pending, undefined);
});
test('cancel after timer completion is harmless', async (context) => {
    context.mock.timers.enable({ apis: ['setTimeout'] });
    const pending = wait(10);
    context.mock.timers.tick(10);
    assert.equal(await pending, undefined);
    pending.cancel();
    assert.equal(await pending, undefined);
});
//# sourceMappingURL=promises.test.js.map