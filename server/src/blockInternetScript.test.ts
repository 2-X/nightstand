import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// block_internet_access.sh runs as root on the pod and saves its result, so
// structural checks are supplemented with fake commands and redirected files.
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

  // Runs the script against stub firewall commands and redirected resolver
  // files, and returns the logged rules and the script's output.
  function runBlock(resolvConf: string, tailscale: boolean, resolved?: string) {
    const folder = mkdtempSync(path.join(tmpdir(), 'nightstand-dns-firewall-'));
    try {
      writeFileSync(path.join(folder, 'resolv.conf'), resolvConf);
      if (resolved !== undefined) writeFileSync(path.join(folder, 'resolved.conf'), resolved);
      for (const tool of ['iptables', 'ip6tables', 'iptables-save', 'ip6tables-save', 'systemctl']) {
        const body = tool === 'systemctl'
          ? `#!/bin/sh\ncase "$*" in *is-active*tailscaled*) exit ${tailscale ? 0 : 1} ;; esac\n`
          : `#!/bin/sh\necho "${tool} $*" >> "$RULE_LOG"\ncase "$1" in -C) exit 1 ;; esac\n`;
        const file = path.join(folder, tool);
        writeFileSync(file, body);
        chmodSync(file, 0o755);
      }
      const script = src.replaceAll('/etc/resolv.conf', path.join(folder, 'resolv.conf'))
        .replaceAll('/run/systemd/resolve/resolv.conf', path.join(folder, 'resolved.conf'))
        .replaceAll('/etc/systemd/timesyncd.conf', path.join(folder, 'timesyncd.conf'))
        .replaceAll('/etc/iptables/', `${folder}/`);
      const output = execFileSync('sh', ['-c', script], {
        encoding: 'utf8',
        env: { ...process.env, PATH: `${folder}:${process.env.PATH}`, RULE_LOG: path.join(folder, 'rules') },
      });
      return { lines: readFileSync(path.join(folder, 'rules'), 'utf8').trim().split('\n'), output };
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  }

  const wanDnsRules = (lines: string[], tool: string) =>
    lines.filter(line => line.startsWith(`${tool} -A OUTPUT -d`) && line.includes('--dport 53 '));

  for (const tailscale of [false, true]) {
    it(`allows only configured WAN resolvers after both flushes${tailscale ? ' with Tailscale' : ''}`, () => {
      const { lines, output } = runBlock([
        'nameserver 9.9.9.9',
        'nameserver 2606:4700:4700::1111',
        'nameserver 2606:4700:4700::1111',
        'nameserver ::ffff:8.8.8.8',
        'nameserver ::ffff:127.0.0.1',
        'nameserver 127.0.0.53',
        'nameserver 10.0.0.1',
        'nameserver 172.16.0.1',
        'nameserver 172.31.255.254',
        'nameserver 192.168.0.1',
        'nameserver ::1',
        'nameserver 0:0:0:0:0:0:0:1',
        'nameserver fe80::1%eth0',
        'nameserver fd12::1',
        'nameserver invalid.example',
        'nameserver 999.1.1.1',
        'nameserver 9.9.9.9/0',
        'nameserver 2606:zzzz::1',
        'nameserver ::',
        'search example.org',
        'nameserver 8.8.4.4',
      ].join('\n'), tailscale);
      assert.deepEqual(output.split('\n').filter(line => line.includes('Allowing DNS')),
        ['Allowing DNS to resolvers: 9.9.9.9 2606:4700:4700::1111 8.8.8.8 8.8.4.4']);
      for (const [tool, resolvers] of [
        ['iptables', ['9.9.9.9', '8.8.8.8', '8.8.4.4']],
        ['ip6tables', ['2606:4700:4700::1111']],
      ] as const) {
        const dns = wanDnsRules(lines, tool);
        assert.deepEqual(dns, resolvers.flatMap(resolver => ['udp', 'tcp'].map(protocol =>
          `${tool} -A OUTPUT -d ${resolver} -p ${protocol} --dport 53 -j ACCEPT`)));
        for (const rule of dns) {
          assert.ok(lines.indexOf(rule) > lines.indexOf(`${tool} -F OUTPUT`));
          assert.ok(lines.indexOf(rule) < lines.indexOf(`${tool} -A OUTPUT -j DROP`));
        }
        assert.ok(lines.includes(`${tool} -I OUTPUT -p udp --dport 123 -j ACCEPT`));
        assert.ok(lines.some(line => line.startsWith(`${tool} -`)
          && line.includes('INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT')));
        const accepts = lines.filter(line => new RegExp(`^${tool} -[AI] OUTPUT `).test(line) && line.endsWith('-j ACCEPT'));
        const tailscaleRules = tool === 'iptables' && tailscale ? [
          'iptables -A OUTPUT -p udp -j ACCEPT',
          'iptables -A OUTPUT -p tcp --dport 443 -j ACCEPT',
          'iptables -A OUTPUT -p udp --dport 53 -j ACCEPT',
          'iptables -A OUTPUT -p tcp --dport 53 -j ACCEPT',
        ] : [];
        assert.deepEqual(accepts, tool === 'iptables' ? [
          'iptables -I OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT',
          'iptables -A OUTPUT -d 10.0.0.0/8 -j ACCEPT',
          'iptables -A OUTPUT -d 172.16.0.0/12 -j ACCEPT',
          'iptables -A OUTPUT -d 192.168.0.0/16 -j ACCEPT',
          ...dns,
          'iptables -I OUTPUT -p udp --dport 123 -j ACCEPT',
          'iptables -A OUTPUT -o lo -j ACCEPT',
          'iptables -A OUTPUT -d 224.0.0.251 -p udp --dport 5353 -j ACCEPT',
          'iptables -A OUTPUT -o tailscale0 -j ACCEPT',
          ...tailscaleRules,
        ] : [
          'ip6tables -A OUTPUT -o lo -j ACCEPT',
          'ip6tables -A OUTPUT -d fe80::/10 -j ACCEPT',
          'ip6tables -A OUTPUT -d fd00::/8 -j ACCEPT',
          ...dns,
          'ip6tables -I OUTPUT -p udp --dport 123 -j ACCEPT',
          'ip6tables -A OUTPUT -d ff02::fb -p udp --dport 5353 -j ACCEPT',
        ], 'no other outbound allowance');
        assert.equal(lines.filter(line => line.startsWith(`${tool} -A INPUT`) && line.includes('--sport 53')).length, 0);
      }
    });
  }

  it('finds the upstream resolvers behind a systemd-resolved stub', () => {
    const { lines, output } = runBlock('nameserver 127.0.0.53\noptions edns0\n', false,
      '# resolved upstream list\nnameserver 192.168.1.1\nnameserver 1.1.1.1\nnameserver 2606:4700:4700::1001\n');
    assert.deepEqual(wanDnsRules(lines, 'iptables'), [
      'iptables -A OUTPUT -d 1.1.1.1 -p udp --dport 53 -j ACCEPT',
      'iptables -A OUTPUT -d 1.1.1.1 -p tcp --dport 53 -j ACCEPT',
    ]);
    assert.deepEqual(wanDnsRules(lines, 'ip6tables'), [
      'ip6tables -A OUTPUT -d 2606:4700:4700::1001 -p udp --dport 53 -j ACCEPT',
      'ip6tables -A OUTPUT -d 2606:4700:4700::1001 -p tcp --dport 53 -j ACCEPT',
    ]);
    assert.match(output, /^Allowing DNS to resolvers: 1\.1\.1\.1 2606:4700:4700::1001$/m);
  });

  it('merges both resolver files without repeating an address', () => {
    const { lines, output } = runBlock('nameserver 9.9.9.9\n', false, 'nameserver 127.0.0.53\nnameserver 9.9.9.9\nnameserver 8.8.8.8\n');
    assert.deepEqual(wanDnsRules(lines, 'iptables').filter(rule => rule.includes('-p udp')), [
      'iptables -A OUTPUT -d 9.9.9.9 -p udp --dport 53 -j ACCEPT',
      'iptables -A OUTPUT -d 8.8.8.8 -p udp --dport 53 -j ACCEPT',
    ]);
    assert.match(output, /^Allowing DNS to resolvers: 9\.9\.9\.9 8\.8\.8\.8$/m);
  });

  for (const [name, resolvConf, resolved] of [
    ['a systemd-resolved stub with no upstream list', 'nameserver 127.0.0.53\n', undefined],
    ['a dnsmasq stub', 'nameserver 127.0.0.1\nnameserver ::1\n', undefined],
    ['stubs and LAN resolvers only', 'nameserver 127.0.0.53\n', 'nameserver 192.168.1.1\nnameserver fe80::1%eth0\n'],
    ['an empty resolv.conf', '', undefined],
  ] as const) {
    it(`says so when ${name} leaves no WAN resolver`, () => {
      const { lines, output } = runBlock(resolvConf, false, resolved);
      assert.equal(wanDnsRules(lines, 'iptables').length, 0);
      assert.equal(wanDnsRules(lines, 'ip6tables').length, 0);
      assert.match(output, /^No WAN DNS resolver found in .*; DNS stays blocked$/m);
      assert.ok(lines.includes('iptables -A OUTPUT -j DROP'));
    });
  }
});
