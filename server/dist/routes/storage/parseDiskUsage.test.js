import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseDfOutput, parseDuOutput } from './parseDiskUsage.js';
describe('parseDfOutput', () => {
    it('parses a POSIX-format df -k -P line', () => {
        const output = 'Filesystem     1024-blocks    Used Available Capacity Mounted on\n'
            + '/dev/mmcblk0p8    15375304 1719180  12853308      12% /persistent\n';
        assert.deepEqual(parseDfOutput(output), {
            totalKb: 15375304,
            usedKb: 1719180,
            availableKb: 12853308,
        });
    });
    it('uses the last line so a wrapped long filesystem name is ignored', () => {
        const output = '/dev/mapper/very-long-volume-group-name-that-wraps\n'
            + '                15375304 1719180  12853308      12% /persistent\n';
        assert.deepEqual(parseDfOutput(output), {
            totalKb: 15375304,
            usedKb: 1719180,
            availableKb: 12853308,
        });
    });
    it('returns null on empty or malformed output', () => {
        assert.equal(parseDfOutput(''), null);
        assert.equal(parseDfOutput('not enough fields'), null);
    });
});
describe('parseDuOutput', () => {
    it('parses the leading KB size from du -sk output', () => {
        assert.equal(parseDuOutput('369692\t/persistent/free-sleep-data\n'), 369692);
    });
    it('returns 0 on empty or malformed output', () => {
        assert.equal(parseDuOutput(''), 0);
        assert.equal(parseDuOutput('not a number\tsomewhere\n'), 0);
    });
});
//# sourceMappingURL=parseDiskUsage.test.js.map