import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import { getLocalSubnetPrefixes, isAllowedOrigin } from './middleware.js';

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

describe('isAllowedOrigin', () => {
  it('accepts the pod\'s mDNS name, with or without a port', () => {
    assert.equal(isAllowedOrigin('http://eight-pod.local:3000'), true);
    assert.equal(isAllowedOrigin('http://eight-pod.local'), true);
  });

  it('rejects names that only contain .local', () => {
    assert.equal(isAllowedOrigin('http://eight-pod.local.example.com'), false);
    assert.equal(isAllowedOrigin('https://example.com'), false);
    assert.equal(isAllowedOrigin('http://example.com/eight-pod.local'), false);
  });

  it('accepts requests without an Origin header', () => {
    assert.equal(isAllowedOrigin(undefined), true);
  });
});
