import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import { getLocalSubnetPrefixes } from './middleware.js';
describe('getLocalSubnetPrefixes', () => {
    it('collects the /24 of every non-internal IPv4 interface', (t) => {
        t.mock.method(os, 'networkInterfaces', () => ({
            eth0: [
                { family: 'IPv4', internal: false, address: '192.168.5.42' },
            ],
            tailscale0: [
                { family: 'IPv4', internal: false, address: '100.64.1.7' },
            ],
            lo: [
                { family: 'IPv4', internal: true, address: '127.0.0.1' },
            ],
        }));
        assert.deepEqual(getLocalSubnetPrefixes(), ['192.168.5.', '100.64.1.']);
        mock.restoreAll();
    });
    it('ignores IPv6 interfaces', (t) => {
        t.mock.method(os, 'networkInterfaces', () => ({
            eth0: [
                { family: 'IPv6', internal: false, address: 'fe80::1' },
            ],
        }));
        assert.deepEqual(getLocalSubnetPrefixes(), []);
        mock.restoreAll();
    });
});
//# sourceMappingURL=middleware.test.js.map