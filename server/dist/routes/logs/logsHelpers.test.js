import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isSafeLogFilename } from './logsHelpers.js';
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
//# sourceMappingURL=logsHelpers.test.js.map