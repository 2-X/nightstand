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
    it('resets the firmware cloud connection before the final drop', () => {
        const reset = src.indexOf('iptables -A OUTPUT -p tcp --dport 1337 -j REJECT --reject-with tcp-reset');
        const drop = src.indexOf('iptables -A OUTPUT -j DROP');
        const save = src.indexOf('iptables-save');
        assert.ok(reset !== -1, 'no tcp-reset rule for port 1337');
        assert.ok(reset < drop && drop < save, 'reset rule must come before the final drop and the save');
    });
    it('lets mDNS answers out so eight-pod.local keeps resolving without Tailscale', () => {
        const gate = src.indexOf('if systemctl is-active --quiet tailscaled; then');
        const gateEnd = src.indexOf('\nfi', gate);
        for (const [rule, drop] of [
            ['iptables -A OUTPUT -d 224.0.0.251 -p udp --dport 5353 -j ACCEPT', 'iptables -A OUTPUT -j DROP'],
            ['ip6tables -A OUTPUT -d ff02::fb -p udp --dport 5353 -j ACCEPT', 'ip6tables -A OUTPUT -j DROP'],
        ]) {
            const at = src.indexOf(rule);
            assert.ok(at !== -1, `missing "${rule}"`);
            assert.ok(at < gate || at > gateEnd, `"${rule}" must not depend on tailscaled`);
            assert.ok(at < src.indexOf(drop), `"${rule}" must come before "${drop}"`);
        }
    });
    it('still saves both rulesets', () => {
        assert.match(src, /iptables-save > \/etc\/iptables\/iptables\.rules/);
        assert.match(src, /ip6tables-save > \/etc\/iptables\/ip6tables\.rules/);
    });
});
//# sourceMappingURL=blockInternetScript.test.js.map