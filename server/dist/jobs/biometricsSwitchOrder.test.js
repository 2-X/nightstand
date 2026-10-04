import { it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
const pending = [];
const ran = [];
let stream = 'on';
let failNext;
let operationRunning = false;
mock.module('child_process', { namedExports: {
        spawn,
        execFile: (command, args, _options, callback) => {
            if (command === '/bin/systemctl' && args.includes('--property=ActiveState')) {
                callback(null, operationRunning && args.includes('free-sleep-update.service') ? 'active' : 'inactive');
            }
            else if (command === '/bin/systemctl')
                callback(null, 'loaded');
            else if (args.includes('-l'))
                callback(null, '');
            else {
                const action = args.includes('/bin/systemctl') ? 'on' : 'off';
                pending.push({
                    command: action,
                    finish: () => {
                        ran.push(action);
                        if (failNext === action) {
                            failNext = undefined;
                            callback(new Error('failed'), '');
                            return;
                        }
                        stream = action;
                        callback(null, '');
                    },
                });
            }
        },
    } });
const { triggerBiometricsDisable, triggerBiometricsEnable } = await import('./biometrics.js');
let flag = 'on';
const save = (value) => async () => { flag = value; return value; };
const request = (value) => (value === 'on' ? triggerBiometricsEnable(save('on')) : triggerBiometricsDisable(save('off')));
// Lets each held command finish in turn, and checks that no two run at once.
async function settle(requests) {
    let done = false;
    const all = Promise.allSettled(requests).then((results) => { done = true; return results; });
    while (!done) {
        await new Promise(resolve => setImmediate(resolve));
        assert.ok(pending.length <= 1, 'one command at a time');
        pending.shift()?.finish();
    }
    return all;
}
for (const sequence of [['off', 'on', 'off'], ['on', 'off', 'on'], ['off', 'off', 'on', 'off']]) {
    it(`ends ${sequence.at(-1)} after ${sequence.join(', ')}`, async () => {
        ran.length = 0;
        const start = sequence[0] === 'on' ? 'off' : 'on';
        flag = start;
        stream = start;
        await settle(sequence.map(request));
        assert.deepEqual(ran, sequence, 'every request runs, in arrival order');
        assert.equal(stream, sequence.at(-1));
        assert.equal(flag, sequence.at(-1));
    });
}
it('saves nothing for a request whose command failed, and still runs the next', async () => {
    ran.length = 0;
    flag = 'off';
    stream = 'off';
    failNext = 'on';
    const [on, off] = await settle([request('on'), request('off')]);
    assert.equal(on.status, 'rejected');
    assert.equal(off.status, 'fulfilled');
    assert.deepEqual(ran, ['on', 'off']);
    assert.equal(flag, 'off');
    assert.equal(stream, 'off');
});
it('returns what the save returned', async () => {
    const result = settle([triggerBiometricsEnable(async () => 'saved')]);
    assert.equal((await result)[0].value, 'saved');
});
// An update stops the stream and then the server, which answers requests
// until it has stopped. A request that reaches its turn then must not start
// the stream again under the update.
it('refuses a queued request whose turn comes while an update runs, and saves nothing', async () => {
    ran.length = 0;
    flag = 'on';
    stream = 'on';
    const requests = [request('off'), request('on')];
    while (pending.length === 0)
        await new Promise(resolve => setImmediate(resolve));
    operationRunning = true;
    try {
        const [off, on] = await settle(requests);
        assert.equal(off.status, 'fulfilled');
        assert.equal(on.status, 'rejected');
        assert.match(String(on.reason), /already running/);
        assert.deepEqual(ran, ['off']);
        assert.equal(stream, 'off');
        assert.equal(flag, 'off');
    }
    finally {
        operationRunning = false;
    }
});
//# sourceMappingURL=biometricsSwitchOrder.test.js.map