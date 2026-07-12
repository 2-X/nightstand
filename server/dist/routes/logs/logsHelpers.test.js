import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isLogFilename, isSafeLogFilename, linesFromAppendedChunk } from './logsHelpers.js';
describe('isLogFilename', () => {
    it('accepts files ending in .log', () => {
        assert.equal(isLogFilename('free-sleep-stream.log'), true);
        assert.equal(isLogFilename('syslog.log'), true);
    });
    it('rejects files that merely contain "log" as a substring', () => {
        assert.equal(isLogFilename('catalog'), false);
        assert.equal(isLogFilename('backlog.txt'), false);
        assert.equal(isLogFilename('logrotate.conf'), false);
    });
});
describe('isSafeLogFilename', () => {
    it('accepts a plain .log basename', () => {
        assert.equal(isSafeLogFilename('free-sleep-stream.log'), true);
    });
    it('rejects relative path traversal', () => {
        assert.equal(isSafeLogFilename('../../etc/passwd'), false);
        assert.equal(isSafeLogFilename('../../../persistent/free-sleep-data/settingsDB.json'), false);
    });
    it('rejects an absolute path even if it ends in .log', () => {
        assert.equal(isSafeLogFilename('/etc/cron.d/evil.log'), false);
    });
    it('rejects an embedded directory separator even if it ends in .log', () => {
        assert.equal(isSafeLogFilename('subdir/evil.log'), false);
    });
    it('rejects non-.log files with no traversal', () => {
        assert.equal(isSafeLogFilename('passwd'), false);
    });
});
describe('linesFromAppendedChunk', () => {
    it('splits multiple newline-terminated lines', () => {
        assert.deepEqual(linesFromAppendedChunk('line1\nline2\nline3\n'), ['line1', 'line2', 'line3']);
    });
    it('keeps a trailing partial line that has not been newline-terminated yet', () => {
        assert.deepEqual(linesFromAppendedChunk('line1\nline2\npartial'), ['line1', 'line2', 'partial']);
    });
    it('returns an empty array for an empty chunk', () => {
        assert.deepEqual(linesFromAppendedChunk(''), []);
    });
    it('returns a single line for a chunk with no trailing newline', () => {
        assert.deepEqual(linesFromAppendedChunk('just one line'), ['just one line']);
    });
});
//# sourceMappingURL=logsHelpers.test.js.map