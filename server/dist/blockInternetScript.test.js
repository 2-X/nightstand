import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// block_internet_access.sh runs as root on the pod and saves its result, so
// it is checked by its structure here rather than run.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = path.join(repoRoot, 'scripts/block_internet_access.sh');
const src = readFileSync(SCRIPT, 'utf8');
describe('block_internet_access.sh', () => {
    it('parses', () => {
        assert.doesNotThrow(() => execFileSync('bash', ['-n', SCRIPT]));
    });
    it('flushes each chain before adding rules, so re-runs do not stack them', () => {
        for (const tool of ['iptables', 'ip6tables']) {
            const firstAppend = src.search(new RegExp(`^${tool} -A`, 'm'));
            for (const chain of ['INPUT', 'OUTPUT']) {
                const flush = src.indexOf(`${tool} -F ${chain}`);
                assert.ok(flush !== -1, `${tool} never flushes ${chain}`);
                assert.ok(flush < firstAppend, `${tool} flushes ${chain} after it starts adding rules`);
            }
        }
    });
    it('opens outbound UDP and HTTPS only while tailscaled is running', () => {
        const gate = src.indexOf('if systemctl is-active --quiet tailscaled; then');
        const end = src.indexOf('\nfi', gate);
        assert.ok(gate !== -1 && end !== -1, 'no tailscaled gate');
        for (const rule of ['iptables -A OUTPUT -p udp -j ACCEPT', 'iptables -A OUTPUT -p tcp --dport 443 -j ACCEPT']) {
            const at = src.indexOf(rule);
            assert.ok(at > gate && at < end, `"${rule}" is outside the tailscaled gate`);
            assert.equal(src.indexOf(rule, at + 1), -1, `"${rule}" appears more than once`);
        }
    });
    it('still saves both rulesets', () => {
        assert.match(src, /iptables-save > \/etc\/iptables\/iptables\.rules/);
        assert.match(src, /ip6tables-save > \/etc\/iptables\/ip6tables\.rules/);
    });
});
//# sourceMappingURL=blockInternetScript.test.js.map