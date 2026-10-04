import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// Runs scripts/restart.sh (fs-restart) with systemctl and sleep replaced by
// stubs that record their arguments. The biometrics stream must follow the
// app's Biometrics switch, which the server keeps in servicesDB.json.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
function run({ services = undefined, streamInstalled = true } = {}) {
    const dir = mkdtempSync(path.join(tmpdir(), 'nightstand-restart-'));
    const lowdb = path.join(dir, 'persistent', 'free-sleep-data', 'lowdb');
    const bin = path.join(dir, 'bin');
    mkdirSync(lowdb, { recursive: true });
    mkdirSync(bin);
    if (services !== undefined)
        writeFileSync(path.join(lowdb, 'servicesDB.json'), services);
    const calls = path.join(dir, 'calls');
    const units = ['free-sleep.service enabled enabled', ...(streamInstalled ? ['free-sleep-stream.service disabled enabled'] : [])];
    const stub = (name, body) => {
        writeFileSync(path.join(bin, name), `#!/bin/sh\necho "${name} $*" >> "${calls}"\n${body}\n`);
        chmodSync(path.join(bin, name), 0o755);
    };
    stub('systemctl', `[ "$1" = list-unit-files ] && printf '%s\\n' ${units.map((u) => `'${u}'`).join(' ')}\nexit 0`);
    stub('sleep', 'exit 0');
    const script = readFileSync(path.join(repoRoot, 'scripts/restart.sh'), 'utf8').replaceAll('/persistent', path.join(dir, 'persistent'));
    const result = spawnSync('bash', ['-c', script], {
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, encoding: 'utf8', timeout: 10_000,
    });
    const log = existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n').filter((l) => !l.includes('list-unit-files')) : [];
    rmSync(dir, { recursive: true, force: true });
    return { ...result, log };
}
describe('restart.sh', () => {
    it('parses', () => {
        assert.equal(spawnSync('bash', ['-n', path.join(repoRoot, 'scripts/restart.sh')]).status, 0);
    });
    it('restarts the server and the stream while Biometrics is on', () => {
        const result = run({ services: '{"biometrics":{"enabled":true}}' });
        assert.equal(result.status, 0, result.stdout + result.stderr);
        for (const call of ['stop free-sleep', 'stop free-sleep-stream', 'enable free-sleep', 'start free-sleep',
            'enable free-sleep-stream', 'start free-sleep-stream']) {
            assert.ok(result.log.includes(`systemctl ${call}`), `${call}\n${result.log.join('\n')}`);
        }
    });
    it('stops and disables the stream while Biometrics is off', () => {
        // The app's switch stops and disables the stream; a restart must not
        // bring it back behind the switch, now or at the next boot.
        for (const services of ['{"biometrics":{"enabled":false}}', undefined, 'not json', '{"biometrics":{"enabled":"yes"}}']) {
            const result = run({ services });
            assert.equal(result.status, 0, result.stdout + result.stderr);
            assert.ok(result.log.includes('systemctl stop free-sleep-stream'), String(services));
            assert.ok(result.log.includes('systemctl disable free-sleep-stream'), `${services}\n${result.log.join('\n')}`);
            assert.ok(result.log.includes('systemctl start free-sleep'), String(services));
            assert.ok(!result.log.some((line) => /(enable|start) free-sleep-stream/.test(line)), `${services}\n${result.log.join('\n')}`);
            assert.match(result.stdout, /Biometrics is off in the app/);
        }
    });
    it('leaves a stream that is not installed alone', () => {
        const result = run({ services: '{"biometrics":{"enabled":true}}', streamInstalled: false });
        assert.equal(result.status, 0);
        assert.ok(!result.log.some((line) => line.includes('free-sleep-stream')), result.log.join('\n'));
        assert.ok(result.log.includes('systemctl start free-sleep'));
    });
});
//# sourceMappingURL=restartScript.test.js.map