import { describe, it } from 'node:test';
import assert from 'node:assert';
import { EventEmitter } from 'node:events';
import { attachRequestCompletionLogging, SLOW_REQUEST_MS } from './requestLogging.js';
function makeSink() {
    const lines = [];
    return {
        lines,
        sink: {
            info: (message) => lines.push({ level: 'info', message }),
            debug: (message) => lines.push({ level: 'debug', message }),
            warn: (message) => lines.push({ level: 'warn', message }),
        },
    };
}
function makeRes(statusCode = 200) {
    const res = new EventEmitter();
    res.statusCode = statusCode;
    return res;
}
const req = { method: 'GET', originalUrl: '/api/deviceStatus' };
describe('attachRequestCompletionLogging', () => {
    it('logs fast 2xx responses at debug', () => {
        const { lines, sink } = makeSink();
        const res = makeRes(200);
        attachRequestCompletionLogging(req, res, sink, () => 1000);
        res.emit('finish');
        res.emit('close'); // node emits close after finish too
        assert.deepStrictEqual(lines, [
            { level: 'debug', message: 'GET /api/deviceStatus - 200 - 0ms' },
        ]);
    });
    it('logs errors and slow responses at info', () => {
        const { lines, sink } = makeSink();
        const res = makeRes(503);
        attachRequestCompletionLogging(req, res, sink, () => 1000);
        res.emit('finish');
        assert.strictEqual(lines[0].level, 'info');
        const slow = makeSink();
        const slowRes = makeRes(200);
        let t = 0;
        attachRequestCompletionLogging(req, slowRes, slow.sink, () => {
            const v = t;
            t += SLOW_REQUEST_MS;
            return v;
        });
        slowRes.emit('finish');
        assert.strictEqual(slow.lines[0].level, 'info');
    });
    it('logs a warn when the client disconnects before any response', () => {
        const { lines, sink } = makeSink();
        const res = makeRes(200);
        let t = 0;
        attachRequestCompletionLogging(req, res, sink, () => (t += 5000) - 5000);
        res.emit('close'); // curl --max-time gave up; finish never fires
        assert.deepStrictEqual(lines, [
            { level: 'warn', message: 'GET /api/deviceStatus - client disconnected after 5000ms with no response sent' },
        ]);
    });
});
//# sourceMappingURL=requestLogging.test.js.map