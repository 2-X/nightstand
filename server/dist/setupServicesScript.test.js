import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// scripts/setup_services.sh installs the units and sudoers rules behind the
// app's Update, Roll back, Revert to stock, Reboot, and biometrics controls.
// install.sh, update.sh, and both migration installers share it, so these run
// it for real against a scratch systemd dir and sudoers file, with systemctl
// and visudo stubbed out.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = path.join(repoRoot, 'scripts/setup_services.sh');
function sandbox(opts = {}) {
    const root = mkdtempSync(path.join(tmpdir(), 'nightstand-services-'));
    const bin = path.join(root, 'bin');
    const systemd = path.join(root, 'systemd');
    const repo = path.join(root, 'repo');
    const calls = path.join(root, 'systemctl-calls');
    const sudoers = path.join(root, 'sudoers');
    for (const dir of [bin, systemd, path.join(repo, 'scripts', 'systemd')])
        mkdirSync(dir, { recursive: true });
    for (const unit of ['free-sleep-rollback.service', 'free-sleep-revert.service']) {
        copyFileSync(path.join(repoRoot, 'scripts/systemd', unit), path.join(repo, 'scripts/systemd', unit));
    }
    writeFileSync(path.join(bin, 'systemctl'), `#!/bin/sh\necho "$@" >> "${calls}"\n`);
    writeFileSync(path.join(bin, 'visudo'), `#!/bin/sh\nexit ${opts.visudoFails ? 1 : 0}\n`);
    chmodSync(path.join(bin, 'systemctl'), 0o755);
    chmodSync(path.join(bin, 'visudo'), 0o755);
    if (opts.existingSudoers !== undefined)
        writeFileSync(sudoers, opts.existingSudoers);
    const run = () => spawnSync('bash', [SCRIPT, repo], {
        encoding: 'utf8',
        env: {
            ...process.env,
            PATH: `${bin}:${process.env.PATH}`,
            NIGHTSTAND_SYSTEMD_DIR: systemd,
            NIGHTSTAND_SUDOERS_FILE: sudoers,
        },
    });
    const read = (file) => readFileSync(file, 'utf8');
    return { run, read, systemd, sudoers, calls };
}
// Every command the server runs through sudo, read from its source.
function serverSudoCommands() {
    const jobsDir = path.join(repoRoot, 'server/src/jobs');
    const commands = [];
    for (const file of readdirSync(jobsDir)) {
        if (!file.endsWith('.ts') || file.endsWith('.test.ts'))
            continue;
        const src = readFileSync(path.join(jobsDir, file), 'utf8');
        for (const m of src.matchAll(/spawn\(\s*'sudo',\s*\[([^\]]*)\]/g)) {
            commands.push([...m[1].matchAll(/'([^']*)'/g)].map((arg) => arg[1]).join(' '));
        }
        for (const m of src.matchAll(/exec\(\s*'sudo ([^']*)'/g))
            commands.push(m[1]);
    }
    return commands;
}
describe('setup_services.sh', () => {
    it('parses and carries the exec bit', () => {
        assert.doesNotThrow(() => execFileSync('bash', ['-n', SCRIPT]));
    });
    it('installs the update, rollback, and revert units without starting any', () => {
        const box = sandbox();
        const result = box.run();
        assert.equal(result.status, 0, result.stdout + result.stderr);
        for (const unit of ['free-sleep-update.service', 'free-sleep-rollback.service', 'free-sleep-revert.service']) {
            assert.ok(box.read(path.join(box.systemd, unit)).length > 0, `${unit} was not installed`);
        }
        assert.equal(box.read(box.calls).trim(), 'daemon-reload');
    });
    it('grants a sudoers rule for every command the server runs through sudo', () => {
        const box = sandbox();
        box.run();
        const rules = box.read(box.sudoers).split('\n');
        const commands = serverSudoCommands();
        assert.ok(commands.length >= 5, `expected the server's sudo calls, found ${commands.length}`);
        for (const command of commands) {
            assert.ok(rules.some((rule) => rule.endsWith(`NOPASSWD: ${command}`)), `no sudoers rule for "sudo ${command}"`);
        }
    });
    it('keeps existing rules and adds nothing twice', () => {
        const existing = 'dac ALL=(ALL) NOPASSWD: /sbin/reboot\ndac ALL=(ALL) NOPASSWD: /usr/bin/something-else\n';
        const box = sandbox({ existingSudoers: existing });
        box.run();
        const once = box.read(box.sudoers);
        assert.ok(once.startsWith(existing), 'existing lines must be kept as they were');
        box.run();
        const twice = box.read(box.sudoers);
        assert.equal(twice, once, 'a second run must not change the file');
        const lines = twice.trim().split('\n');
        assert.equal(new Set(lines).size, lines.length, 'no rule may appear twice');
    });
    it('leaves the sudoers file alone and fails when visudo rejects the result', () => {
        const existing = 'dac ALL=(ALL) NOPASSWD: /sbin/reboot\n';
        const box = sandbox({ existingSudoers: existing, visudoFails: true });
        const result = box.run();
        assert.notEqual(result.status, 0);
        assert.equal(box.read(box.sudoers), existing);
    });
});
//# sourceMappingURL=setupServicesScript.test.js.map