import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
process.env.DATA_FOLDER = `${mkdtempSync(path.join(tmpdir(), 'nightstand-config-'))}/`;
process.env.ENV = 'local';
let sockPathFromFrankScript;
let pickSockPath;
before(async () => {
    ({ sockPathFromFrankScript, pickSockPath } = await import('./config.js'));
});
describe('sockPathFromFrankScript', () => {
    it('reads the socket path the way the installer does', () => {
        const frank = '#!/bin/sh\nexport DAC_SOCKET=/persistent/deviceinfo/dac.sock\nexec /opt/eight/bin/frankenfirmware\n';
        assert.equal(sockPathFromFrankScript(frank), '/persistent/deviceinfo/dac.sock');
    });
    it('ignores a value that is not a dac.sock path', () => {
        assert.equal(sockPathFromFrankScript('DAC_SOCKET=/tmp/other\n'), undefined);
        assert.equal(sockPathFromFrankScript(''), undefined);
    });
});
describe('pickSockPath', () => {
    const firmware = () => '/persistent/deviceinfo/dac.sock';
    it('prefers the installer copy', () => {
        assert.equal(pickSockPath('/custom/dac.sock', false, firmware), '/custom/dac.sock');
    });
    it('falls back to the firmware when the copy is missing or empty', () => {
        assert.equal(pickSockPath(undefined, false, firmware), '/persistent/deviceinfo/dac.sock');
        assert.equal(pickSockPath('', false, firmware), '/persistent/deviceinfo/dac.sock');
    });
    it('never reads the firmware in remote dev mode', () => {
        assert.equal(pickSockPath('', true, () => { throw new Error('read'); }), undefined);
    });
});
//# sourceMappingURL=configSockPath.test.js.map