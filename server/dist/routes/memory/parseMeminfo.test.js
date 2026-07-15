import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseMeminfo } from './parseMeminfo.js';
describe('parseMeminfo', () => {
    it('parses MemTotal and MemAvailable from real /proc/meminfo output', () => {
        const text = 'MemTotal:        2014796 kB\n'
            + 'MemFree:          287184 kB\n'
            + 'MemAvailable:    1486852 kB\n'
            + 'Buffers:           38212 kB\n';
        assert.deepEqual(parseMeminfo(text), { totalKb: 2014796, availableKb: 1486852 });
    });
    it('returns null when a required field is missing', () => {
        assert.equal(parseMeminfo('MemTotal:        2014796 kB\n'), null);
        assert.equal(parseMeminfo(''), null);
    });
});
//# sourceMappingURL=parseMeminfo.test.js.map