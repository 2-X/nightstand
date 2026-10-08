import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// The updaters open a narrow internet window for the download. These tests run
// the real window functions and the real block script against a fake iptables
// that keeps its rules in files, so the firewall's state can be compared
// before, during and after the window.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (file: string) => readFileSync(path.join(repoRoot, file), 'utf8');
const between = (src: string, from: string, to: string) => {
  const start = src.indexOf(from);
  assert.ok(start >= 0, `missing ${from}`);
  const end = src.indexOf(to, start);
  assert.ok(end > start, `missing ${to} after ${from}`);
  return src.slice(start, end);
};

const FAKE_IPTABLES = `#!/bin/bash
tool=\${0##*/}
dir="$FAKE_FW/$tool"
mkdir -p "$dir"
args=()
table=filter
while [ $# -gt 0 ]; do
  case "$1" in
    -w)
      # iptables before 1.6.0 takes a bare -w, and before 1.4.20 has none.
      case "\${FAKE_IPT_W:-modern}" in
        none) echo "$tool: unknown option -w" >&2; exit 2 ;;
        bare) case "\${2:-}" in [0-9]*) echo "$tool: unknown arguments found on commandline" >&2; exit 2 ;; esac; shift ;;
        *) case "\${2:-}" in [0-9]*) shift 2 ;; *) shift ;; esac ;;
      esac ;;
    -t) table=$2; shift 2 ;;
    *) args+=("$1"); shift ;;
  esac
done
[ "\${args[0]}" = -S ] || echo "$tool \${args[*]}" >> "$FAKE_FW/calls"
[ "$table" = filter ] || exit 0
op=\${args[0]}
chain=\${args[1]:-}
rest=("\${args[@]:2}")
case "$op" in
  -S)
    # Listed the way iptables prints rules, with the implicit -m tcp or -m udp.
    for c in \${chain:-INPUT OUTPUT}; do
      echo "-P $c ACCEPT"
      [ -f "$dir/$c" ] && sed -E -e "s/^/-A $c /" -e 's/-p (tcp|udp) --(d|s)port/-p \\1 -m \\1 --\\2port/' "$dir/$c" |
        if [ "\${FAKE_SPACING:-no}" = yes ]; then sed -E -e 's/ /  /g' -e 's/$/ /'; else cat; fi
    done
    exit 0 ;;
  -X) exit 0 ;;
  -F)
    if [ -n "$chain" ]; then : > "$dir/$chain"; else : > "$dir/INPUT"; : > "$dir/OUTPUT"; fi
    exit 0 ;;
esac
touch "$dir/$chain"
case "$op" in
  -A) echo "\${rest[*]}" >> "$dir/$chain" ;;
  -I)
    pos=1
    case "\${rest[0]}" in [0-9]*) pos=\${rest[0]}; rest=("\${rest[@]:1}") ;; esac
    awk -v pos="$pos" -v rule="\${rest[*]}" \\
      'NR == pos { print rule; done = 1 } { print } END { if (!done) print rule }' "$dir/$chain" > "$dir/tmp"
    mv "$dir/tmp" "$dir/$chain" ;;
  -C) grep -Fxq -- "\${rest[*]}" "$dir/$chain" ;;
  -D)
    awk -v rule="\${rest[*]}" '!done && $0 == rule { done = 1; next } { print } END { exit done ? 0 : 1 }' "$dir/$chain" > "$dir/tmp"
    status=$?
    mv "$dir/tmp" "$dir/$chain"
    exit $status ;;
  *) echo "fake iptables: unsupported $op" >&2; exit 2 ;;
esac
`;

const FAKE_SAVE = `#!/bin/bash
tool=\${0##*/}
"\${tool%-save}" -S
`;

const FAKE_SYSTEMCTL = `#!/bin/bash
case "$*" in
  *is-active*tailscaled*) [ "$FAKE_TAILSCALE" = yes ] ;;
  *) exit 0 ;;
esac
`;

function rules(dir: string) {
  return ['iptables', 'ip6tables'].map(tool => {
    const result = spawnSync(path.join(dir, 'bin', tool), ['-S'], {
      env: { ...process.env, FAKE_FW: path.join(dir, 'fw') }, encoding: 'utf8',
    });
    return `# ${tool}\n${result.stdout}`;
  }).join('');
}

type Fixture = { dir: string; env: NodeJS.ProcessEnv; before: string };

const FAKE_SUDO = `#!/bin/bash
echo "sudo $*" >> "$F/sudo-calls"
if [ ! -f "$F/window" ]; then
  { iptables -S; echo; ip6tables -S; } > "$F/window"
  cp "$FAKE_FW/calls" "$F/window-calls" 2>/dev/null || : > "$F/window-calls"
fi
remote_shell() {
  local p=$PPID
  until ps -o args= -p "$p" | grep -q 'bash -s --'; do p=$(ps -o ppid= -p "$p" | tr -d ' '); done
  echo "$p"
}
[ "\${FAKE_HANGUP:-no}" = no ] || kill -HUP "$(remote_shell)"
if [ "\${FAKE_KILL_REMOTE:-no}" = yes ]; then
  # SIGKILL the remote shell the way the out of memory killer would.
  kill -KILL "$(remote_shell)"
  sleep 5
fi
if [ "\${FAKE_DROP_WINDOW:-no}" = yes ] && [ ! -f "$F/dropped" ]; then
  touch "$F/dropped"
  iptables -D OUTPUT -p tcp --dport 443 -j ACCEPT
fi
case "$*" in
  *install*) [ "\${FAKE_INSTALL:-ok}" = ok ] ;;
  *) [ "\${FAKE_FETCH:-ok}" = ok ] ;;
esac
`;

function closeScript(dir: string) {
  return read('scripts/close_update_window.sh')
    .replaceAll('/home/dac/free-sleep-prev', `${dir}/prev`)
    .replaceAll('/home/dac/free-sleep', `${dir}/live`);
}

function fixture(tailscale = false, blockScripts: 'live' | 'prev' | 'none' = 'live', unblocked = false): Fixture {
  const dir = mkdtempSync(path.join(tmpdir(), 'nightstand-update-firewall-'));
  const bin = path.join(dir, 'bin');
  mkdirSync(bin);
  const tools: Array<[string, string]> = [
    ['iptables', FAKE_IPTABLES], ['ip6tables', FAKE_IPTABLES],
    ['iptables-save', FAKE_SAVE], ['ip6tables-save', FAKE_SAVE], ['systemctl', FAKE_SYSTEMCTL],
    ['sudo', FAKE_SUDO],
  ];
  for (const [name, body] of tools) {
    writeFileSync(path.join(bin, name), body);
    chmodSync(path.join(bin, name), 0o755);
  }
  writeFileSync(path.join(dir, 'resolv.conf'), 'nameserver 9.9.9.9\nnameserver 2606:4700:4700::1111\n');
  const block = read('scripts/block_internet_access.sh')
    .replaceAll('/etc/resolv.conf', `${dir}/resolv.conf`)
    .replaceAll('/run/systemd/resolve/resolv.conf', `${dir}/resolved.conf`)
    .replaceAll('/etc/systemd/timesyncd.conf', `${dir}/timesyncd.conf`)
    .replaceAll('/etc/iptables/', `${dir}/`);
  for (const tree of ['live', 'prev']) {
    mkdirSync(path.join(dir, tree, 'scripts'), { recursive: true });
    if (blockScripts === tree) writeFileSync(path.join(dir, tree, 'scripts/block_internet_access.sh'), block);
  }
  mkdirSync(path.join(dir, 'stage/scripts'), { recursive: true });
  writeFileSync(path.join(dir, 'stage/scripts/block_internet_access.sh'), block);
  writeFileSync(path.join(dir, 'stage/scripts/close_update_window.sh'), closeScript(dir));
  const env = {
    ...process.env, PATH: `${bin}:${process.env.PATH}`, FAKE_FW: path.join(dir, 'fw'),
    FAKE_TAILSCALE: tailscale ? 'yes' : 'no', F: dir,
  };
  // The Pod's normal state before an update: the block script has run.
  writeFileSync(path.join(dir, 'block.sh'), block);
  const applied = spawnSync('sh', [path.join(dir, 'block.sh')], { env, encoding: 'utf8' });
  assert.equal(applied.status, 0, applied.stderr);
  if (unblocked) {
    const opened = spawnSync('sh', [path.join(repoRoot, 'scripts/unblock_internet_access.sh')], { env, encoding: 'utf8' });
    assert.equal(opened.status, 0, opened.stderr);
  }
  rmSync(path.join(dir, 'fw/calls'), { force: true });
  return { dir, env, before: rules(dir) };
}


function driver(file: string, body: string) {
  const src = read(file);
  const traps = between(src, 'trap cleanup EXIT', '\n\n').trim();
  return `set -uo pipefail
LIVE="$F/live"; PREV="$F/prev"; STAGE="$F/stage"; ZIP="$F/download.zip"; BK="$F/backup"
SWAP_MARKER="$F/swap-marker"
say() { echo "$*"; }
restore_switch_data() { :; }
snapshot() {
  { iptables -S; echo; ip6tables -S; } > "$F/window"
  cp "$F/fw/calls" "$F/window-calls" 2>/dev/null || : > "$F/window-calls"
}
${between(src, '# While downloading', '# Free-space helpers')}
${traps}
${body}`;
}

function windowRules(f: Fixture) {
  const [v4, v6] = readFileSync(path.join(f.dir, 'window'), 'utf8').split('\n\n');
  const lines = (text: string) => text.trim().split('\n');
  return { v4: lines(v4), v6: lines(v6), calls: readFileSync(path.join(f.dir, 'window-calls'), 'utf8') };
}

const OPENED = [
  '-A OUTPUT -p tcp -m tcp --dport 53 -j ACCEPT',
  '-A OUTPUT -p udp -m udp --dport 53 -j ACCEPT',
  '-A OUTPUT -p tcp -m tcp --dport 443 -j ACCEPT',
];
const IPV6_REFUSED = '-A OUTPUT -p tcp -m tcp --dport 443 -j REJECT --reject-with tcp-reset';

const chain = (lines: string[], name: string) => lines.filter(line => line.startsWith(`-A ${name} `));

function assertNarrowWindow(f: Fixture) {
  const [beforeV4, beforeV6] = f.before.split('# ip6tables\n')
    .map(text => text.replace('# iptables\n', '').trim().split('\n'));
  const window = windowRules(f);
  assert.deepEqual(chain(window.v4, 'INPUT'), chain(beforeV4, 'INPUT'), 'IPv4 INPUT must not change');
  assert.deepEqual(chain(window.v6, 'INPUT'), chain(beforeV6, 'INPUT'), 'IPv6 INPUT must not change');
  const output = chain(window.v4, 'OUTPUT');
  assert.deepEqual(output.slice(0, 3), OPENED);
  assert.deepEqual(output.slice(3), chain(beforeV4, 'OUTPUT'), 'the rest of IPv4 OUTPUT must stay as it was');
  assert.ok(output.includes('-A OUTPUT -p tcp -m tcp --dport 1337 -j REJECT --reject-with tcp-reset'));
  assert.equal(output.at(-1), '-A OUTPUT -j DROP');
  assert.deepEqual(chain(window.v6, 'OUTPUT'), [IPV6_REFUSED, ...chain(beforeV6, 'OUTPUT')]);
  assert.doesNotMatch(window.calls, / -F| -X|INPUT|unblock/, window.calls);
}

function cleanup(f: Fixture) {
  rmSync(f.dir, { recursive: true, force: true });
}

for (const file of ['scripts/update.sh', 'scripts/switch-to-upstream.sh']) {
  describe(`${file} internet window`, () => {
    const src = read(file);

    it('never runs the full unblock anywhere in the script', () => {
      // Exclude only the legacy cron matcher, which reports existing jobs.
      const executable = src.split('\n').filter(line => !/^\s*#/.test(line)).join('\n')
        .replaceAll('/\\/home\\/dac\\/free-sleep\\/scripts\\/unblock_internet_access[.]sh/', '');
      assert.doesNotMatch(executable, /unblock_internet_access/);
    });

    it('puts a time limit on the dependency install', () => {
      assert.match(src, /run_limited 900 sudo -u dac bash -c "cd '\$STAGE\/server' && '\$NPM' install/);
    });

    for (const tailscale of [false, true]) {
      it(`opens only HTTPS and DNS and restores the block on success${tailscale ? ' with Tailscale' : ''}`, () => {
        const f = fixture(tailscale);
        try {
          const result = spawnSync('bash', ['-c', driver(file, `open_wan
snapshot
run_limited 900 true || fail "install failed"
close_wan
exit 0`)], { env: f.env, encoding: 'utf8', timeout: 10000 });
          assert.equal(result.status, 0, result.stdout + result.stderr);
          assertNarrowWindow(f);
          assert.equal(rules(f.dir), f.before);
        } finally {
          cleanup(f);
        }
      });
    }

    it('restores the block when the install fails', () => {
      const f = fixture();
      try {
        const result = spawnSync('bash', ['-c', driver(file, `open_wan
snapshot
run_limited 900 false || fail "install failed"`)], { env: f.env, encoding: 'utf8', timeout: 10000 });
        assert.equal(result.status, 1, result.stdout + result.stderr);
        assert.match(result.stdout, /FATAL: install failed/);
        assertNarrowWindow(f);
        assert.equal(rules(f.dir), f.before);
      } finally {
        cleanup(f);
      }
    });

    for (const [label, setup] of [
      ['without a usable timeout command', 'timeout() { return 127; }'],
      ...(spawnSync('timeout', ['1', 'true']).status === 0 ? [['with the system timeout command', '']] : []),
    ]) {
      it(`gives up on a stalled install and restores the block ${label}`, () => {
        const f = fixture();
        try {
          const started = Date.now();
          const result = spawnSync('bash', ['-c', driver(file, `${setup}
open_wan
snapshot
run_limited 2 sleep 30 || fail "install timed out"`)], { env: f.env, encoding: 'utf8', timeout: 20000 });
          assert.equal(result.status, 1, result.stdout + result.stderr);
          assert.match(result.stdout, /FATAL: install timed out/);
          assert.ok(Date.now() - started < 15000, 'the limit did not stop the command');
          assertNarrowWindow(f);
          assert.equal(rules(f.dir), f.before);
        } finally {
          cleanup(f);
        }
      });
    }

    it('passes the limit to the system timeout command when it works', () => {
      const result = spawnSync('bash', ['-c', `${between(src, 'run_limited() {', '\n}\n')}\n}
timeout() { echo "timeout $*"; [ "$1" = 1 ] || { shift; "$@"; }; }
run_limited 900 echo installed`], { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /timeout 900 echo installed\ninstalled/);
    });

    for (const signal of ['SIGTERM', 'SIGHUP', 'SIGINT'] as const) {
      it(`restores the block when stopped by ${signal}`, async () => {
        const f = fixture();
        try {
          const child = spawn('bash', ['-c', driver(file, `open_wan
snapshot
touch "$F/ready"
sleep 30`)], { env: f.env, detached: true, stdio: 'ignore' });
          const exited = new Promise<number | null>(resolve => child.on('exit', code => resolve(code)));
          const deadline = Date.now() + 10000;
          while (!existsSync(path.join(f.dir, 'ready')) && Date.now() < deadline) {
            await new Promise(resolve => setTimeout(resolve, 50));
          }
          assert.ok(existsSync(path.join(f.dir, 'ready')), 'the window never opened');
          assert.ok(child.pid);
          process.kill(-child.pid, signal);
          const code = await exited;
          assert.notEqual(code, 0);
          assertNarrowWindow(f);
          assert.equal(rules(f.dir), f.before);
        } finally {
          cleanup(f);
        }
      });
    }

    it('leaves Tailscale\'s own rules alone when the window rule is already gone', () => {
      const f = fixture(true, 'none');
      try {
        const result = spawnSync('bash', ['-c', driver(file, `open_wan
iptables -D OUTPUT -p tcp --dport 443 -j ACCEPT
iptables -D OUTPUT -p tcp --dport 53 -j ACCEPT
close_wan`)], { env: f.env, encoding: 'utf8', timeout: 10000 });
        assert.equal(result.status, 0, result.stdout + result.stderr);
        assert.equal(rules(f.dir), f.before);
      } finally {
        cleanup(f);
      }
    });

    it('falls back to the previous block script', () => {
      const f = fixture(false, 'prev');
      try {
        const result = spawnSync('bash', ['-c', driver(file, `open_wan
snapshot
fail "download failed"`)], { env: f.env, encoding: 'utf8', timeout: 10000 });
        assert.equal(result.status, 1, result.stdout + result.stderr);
        assert.equal(rules(f.dir), f.before);
        assert.match(readFileSync(path.join(f.dir, 'fw/calls'), 'utf8'), /iptables -F OUTPUT/);
      } finally {
        cleanup(f);
      }
    });

    it('still removes the window when no block script can run', () => {
      const f = fixture(false, 'none');
      try {
        const result = spawnSync('bash', ['-c', driver(file, `open_wan
snapshot
fail "download failed"`)], { env: f.env, encoding: 'utf8', timeout: 10000 });
        assert.equal(result.status, 1, result.stdout + result.stderr);
        assertNarrowWindow(f);
        assert.equal(rules(f.dir), f.before);
      } finally {
        cleanup(f);
      }
    });
  });
}

it('switch-to-upstream.sh puts a time limit on the biometrics package install', () => {
  assert.match(read('scripts/switch-to-upstream.sh'), /run_limited 600 "\$\{PIP_RUNNER\[@\]\}" \/home\/dac\/venv\/bin\/python -m pip install/);
});

// An updater killed outright never runs its cleanup; the units' ExecStopPost
// runs this script instead.
function runCloseScript(f: Fixture, env: NodeJS.ProcessEnv = {}) {
  writeFileSync(path.join(f.dir, 'close.sh'), closeScript(f.dir));
  return spawnSync('bash', [path.join(f.dir, 'close.sh')], { env: { ...f.env, ...env }, encoding: 'utf8', timeout: 10000 });
}

function killInWindow(file: string, f: Fixture) {
  const killed = spawnSync('bash', ['-c', driver(file, `open_wan
snapshot
kill -KILL $$`)], { env: f.env, encoding: 'utf8', timeout: 10000 });
  assert.equal(killed.signal, 'SIGKILL', killed.stdout + killed.stderr);
  assert.notEqual(rules(f.dir), f.before, 'a killed updater should have left its window open');
  rmSync(path.join(f.dir, 'fw/calls'), { force: true });
}

const calls = (f: Fixture) => {
  try { return readFileSync(path.join(f.dir, 'fw/calls'), 'utf8'); } catch { return ''; }
};

for (const file of ['scripts/update.sh', 'scripts/switch-to-upstream.sh', 'scripts/close_update_window.sh', 'ops/deploy.sh']) {
  it(`${file} never hard-codes the -w 5 form of iptables`, () => {
    assert.doesNotMatch(read(file), /ip6?tables -w 5/);
  });
}

// iptables before 1.6.0 rejects "-w 5", and before 1.4.20 rejects -w at all.
// The window must still open and close on those builds.
for (const mode of ['bare', 'none']) {
  for (const file of ['scripts/update.sh', 'scripts/switch-to-upstream.sh']) {
    it(`${file} opens and closes the window on iptables with ${mode === 'bare' ? 'a bare -w' : 'no -w'}`, () => {
      const f = fixture(true);
      try {
        const result = spawnSync('bash', ['-c', driver(file, `open_wan
snapshot
close_wan
exit 0`)], { env: { ...f.env, FAKE_IPT_W: mode }, encoding: 'utf8', timeout: 10000 });
        assert.equal(result.status, 0, result.stdout + result.stderr);
        assert.doesNotMatch(result.stdout + result.stderr, /WARNING|unknown/);
        assertNarrowWindow(f);
        assert.equal(rules(f.dir), f.before);
      } finally {
        cleanup(f);
      }
    });
  }

  it(`the close script finds and removes a left window on iptables with ${mode === 'bare' ? 'a bare -w' : 'no -w'}`, () => {
    const f = fixture(true);
    try {
      killInWindow('scripts/update.sh', f);
      const result = runCloseScript(f, { FAKE_IPT_W: mode });
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.equal(rules(f.dir), f.before);
    } finally {
      cleanup(f);
    }
  });
}

describe('after the update or revert unit stops', () => {
  const STOP_POST = 'ExecStopPost=-/bin/bash /home/dac/free-sleep/scripts/close_update_window.sh';

  it('both units run the window check after any stop', () => {
    assert.ok(between(read('scripts/setup_services.sh'), 'free-sleep-update.service" <<EOF', '\nEOF').includes(STOP_POST));
    assert.ok(read('scripts/systemd/free-sleep-revert.service').includes(STOP_POST));
    assert.ok(statSync(path.join(repoRoot, 'scripts/close_update_window.sh')).mode & 0o111);
  });

  for (const file of ['scripts/update.sh', 'scripts/switch-to-upstream.sh']) {
    for (const tailscale of [false, true]) {
      it(`closes the window ${file} left when it was killed${tailscale ? ' with Tailscale' : ''}`, () => {
        const f = fixture(tailscale);
        try {
          killInWindow(file, f);
          assertNarrowWindow(f);
          const result = runCloseScript(f);
          assert.equal(result.status, 0, result.stdout + result.stderr);
          assert.equal(rules(f.dir), f.before);
          assert.match(calls(f), /iptables -F OUTPUT/, 'the block script should run again');
        } finally {
          cleanup(f);
        }
      });
    }

    it(`only removes the window ${file} left when internet was unblocked on purpose`, () => {
      const f = fixture(false, 'live', true);
      try {
        killInWindow(file, f);
        const result = runCloseScript(f);
        assert.equal(result.status, 0, result.stdout + result.stderr);
        assert.equal(rules(f.dir), f.before);
        assert.doesNotMatch(calls(f), / -F | -A | -I /);
      } finally {
        cleanup(f);
      }
    });
  }

  it('matches rules printed with different spacing', () => {
    const f = fixture(true);
    try {
      killInWindow('scripts/update.sh', f);
      const result = runCloseScript(f, { FAKE_SPACING: 'yes' });
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stdout, /Removed the download rules/);
      assert.equal(rules(f.dir), f.before);
    } finally {
      cleanup(f);
    }
  });

  // Another firewall manager may insert its own rule above the window.
  const FOREIGN = '-o wg0 -j ACCEPT';
  const insertAbove = (f: Fixture) => {
    const inserted = spawnSync('iptables', ['-I', 'OUTPUT', '1', ...FOREIGN.split(' ')], { env: f.env, encoding: 'utf8' });
    assert.equal(inserted.status, 0, inserted.stderr);
    rmSync(path.join(f.dir, 'fw/calls'), { force: true });
  };
  const withForeign = (before: string) => before.replace(/^(-A OUTPUT )/m, `-A OUTPUT ${FOREIGN}\n$1`);

  for (const tailscale of [false, true]) {
    it(`closes a window left below another rule and blocks again${tailscale ? ' with Tailscale' : ''}`, () => {
      const f = fixture(tailscale);
      try {
        killInWindow('scripts/update.sh', f);
        insertAbove(f);
        const result = runCloseScript(f);
        assert.equal(result.status, 0, result.stdout + result.stderr);
        assert.match(result.stdout, /Removed the download rules/);
        assert.match(calls(f), /iptables -F OUTPUT/, 'the block script should run again');
        assert.equal(rules(f.dir), f.before);
      } finally {
        cleanup(f);
      }
    });

    it(`removes only the window's own rules, wherever they are${tailscale ? ', keeping Tailscale\'s' : ''}`, () => {
      // Without a block script to run again, what is left shows what was removed.
      const f = fixture(tailscale, 'none');
      try {
        killInWindow('scripts/update.sh', f);
        insertAbove(f);
        const result = runCloseScript(f);
        assert.equal(result.status, 0, result.stdout + result.stderr);
        assert.equal(rules(f.dir), withForeign(f.before));
        assert.doesNotMatch(calls(f), new RegExp(`-D OUTPUT ${FOREIGN}`));
      } finally {
        cleanup(f);
      }
    });
  }

  it('removes a window left below another rule when internet was unblocked on purpose', () => {
    const f = fixture(false, 'live', true);
    try {
      killInWindow('scripts/update.sh', f);
      insertAbove(f);
      const result = runCloseScript(f);
      assert.equal(result.status, 0, result.stdout + result.stderr);
      // The IPv4 OUTPUT chain was empty, apart from the window, before the rule was added.
      assert.equal(rules(f.dir), f.before.replace(/^-P OUTPUT ACCEPT$/m, `-P OUTPUT ACCEPT\n-A OUTPUT ${FOREIGN}`));
      assert.doesNotMatch(calls(f), / -F | -A | -I /);
    } finally {
      cleanup(f);
    }
  });

  for (const tailscale of [false, true]) {
    it(`preserves resolver allowances when cleanup cannot reapply the block${tailscale ? ' with Tailscale' : ''}`, () => {
      const f = fixture(tailscale, 'none');
      try {
        assert.match(f.before, /-d 9\.9\.9\.9 -p udp -m udp --dport 53 -j ACCEPT/);
        assert.match(f.before, /-d 2606:4700:4700::1111 -p tcp -m tcp --dport 53 -j ACCEPT/);
        killInWindow('scripts/update.sh', f);
        const result = runCloseScript(f);
        assert.equal(result.status, 0, result.stdout + result.stderr);
        assert.equal(rules(f.dir), f.before);
      } finally {
        cleanup(f);
      }
    });
  }

  it('changes nothing when no window is left, even with matching Tailscale rules', () => {
    const f = fixture(true);
    try {
      const result = runCloseScript(f);
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.equal(calls(f), '');
      assert.equal(rules(f.dir), f.before);
    } finally {
      cleanup(f);
    }
  });
});

type NodeCase = { stagePin: string; livePin: string; cached?: boolean; lockSame?: boolean; fetchFails?: boolean };

function dependencies(file: string, c: NodeCase) {
  const dir = mkdtempSync(path.join(tmpdir(), 'nightstand-node-fetch-'));
  for (const [tree, pin, lock] of [['live', c.livePin, 'a'], ['stage', c.stagePin, c.lockSame === false ? 'b' : 'a']]) {
    mkdirSync(path.join(dir, tree, 'server'), { recursive: true });
    writeFileSync(path.join(dir, tree, 'server/package.json'), JSON.stringify({ volta: { node: pin } }));
    writeFileSync(path.join(dir, tree, 'server/package-lock.json'), lock);
  }
  if (c.cached) mkdirSync(path.join(dir, `volta/tools/image/node/${c.stagePin}`), { recursive: true });
  const src = read(file).replaceAll('/home/dac/.volta', `${dir}/volta`);
  const section = file === 'scripts/update.sh'
    ? `${between(src, '# --- dependencies', '  # Only to a copy that carries the marker')}\nfi`
    : between(src, '# --- dependencies', '# --- backup');
  const result = spawnSync('bash', ['-c', `set -uo pipefail
LIVE="$F/live"; STAGE="$F/stage"; NPM=npm; HANDOFF=0; MODULES_MB=0; SPACE_MARGIN_MB=0
say() { echo "$*"; }
fail() { echo "FATAL: $*"; exit 1; }
free_mb() { echo 999999; }
sudo() { echo "sudo $*" >> "$F/calls"; case "$*" in *--version*) [ "$FETCH_FAILS" = no ] ;; esac; }
run_limited() { echo "limited $1" >> "$F/calls"; shift; "$@"; }
close_wan() { echo close_wan >> "$F/calls"; }
${between(src, 'node_pin() {', '\n\n')}
${section}
echo finished`], { env: { ...process.env, F: dir, FETCH_FAILS: c.fetchFails ? 'yes' : 'no' }, encoding: 'utf8' });
  let log = '';
  try { log = readFileSync(path.join(dir, 'calls'), 'utf8'); } catch { /* nothing ran */ }
  rmSync(dir, { recursive: true, force: true });
  return { ...result, log: log.replaceAll(dir, '$F') };
}

for (const file of ['scripts/update.sh', 'scripts/switch-to-upstream.sh']) {
  describe(`${file} fetches a newly pinned Node inside the window`, () => {
    const FETCH = "limited 600\nsudo -u dac bash -c cd '$F/stage/server' && 'npm' --version\n";

    it('when the pin changes and the lockfile does not', () => {
      const result = dependencies(file, { stagePin: '24.12.0', livePin: '24.11.0' });
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.equal(result.log, `${FETCH}close_wan\n`);
    });

    it('after the install when both change', () => {
      const result = dependencies(file, { stagePin: '24.12.0', livePin: '24.11.0', lockSame: false });
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.match(result.log, /^limited 900\nsudo .* install .*\nlimited 600\n.*--version\nclose_wan\n$/);
    });

    for (const [label, c] of [
      ['the pin is unchanged', { stagePin: '24.11.0', livePin: '24.11.0' }],
      ['Volta already has it', { stagePin: '24.12.0', livePin: '24.11.0', cached: true }],
    ] as Array<[string, NodeCase]>) {
      it(`not when ${label}`, () => {
        const result = dependencies(file, c);
        assert.equal(result.status, 0, result.stdout + result.stderr);
        assert.equal(result.log, 'close_wan\n');
      });
    }

    it('and stops before the swap when the fetch fails', () => {
      const result = dependencies(file, { stagePin: '24.12.0', livePin: '24.11.0', fetchFails: true });
      assert.equal(result.status, 1);
      assert.match(result.stdout, /FATAL: could not fetch Node 24\.12\.0/);
      assert.doesNotMatch(result.stdout, /finished/);
      assert.equal(result.log, FETCH);
    });
  });
}

describe('ops/deploy.sh dependency window', () => {
  const src = read('ops/deploy.sh');

  it('never runs the full unblock', () => {
    assert.doesNotMatch(src, /unblock_internet_access/);
  });

  function deploy(f: Fixture, opts: { lockSame?: boolean; cached?: boolean; env?: NodeJS.ProcessEnv } = {}) {
    for (const [tree, lock] of [['live', 'a'], ['stage', opts.lockSame ? 'a' : 'b']]) {
      mkdirSync(path.join(f.dir, tree, 'server'), { recursive: true });
      writeFileSync(path.join(f.dir, tree, 'server/package-lock.json'), lock);
    }
    if (opts.cached) mkdirSync(path.join(f.dir, 'volta/tools/image/node/24.12.0'), { recursive: true });
    const section = between(src, '# --- dependencies (while old server still runs)', '# --- atomic swap')
      .replaceAll('/home/dac/.volta', `${f.dir}/volta`);
    return spawnSync('bash', ['-c', `set -uo pipefail
LIVE="$F/live"; STAGE="$F/stage"; NPM=npm; NODE_PIN=24.12.0
say() { echo "$*"; }
die() { echo "FATAL: $*"; exit 1; }
SSH() { bash -c "$*"; }
${section}
echo finished`], { env: { ...f.env, ...opts.env }, encoding: 'utf8', timeout: 20000 });
  }
  const sudoCalls = (f: Fixture) => {
    try { return readFileSync(path.join(f.dir, 'sudo-calls'), 'utf8'); } catch { return ''; }
  };

  for (const [label, opts] of [
    ['a changed lockfile', { cached: true }],
    ['a Node Volta does not have yet', { lockSame: true }],
  ] as Array<[string, { lockSame?: boolean; cached?: boolean }]>) {
    it(`opens only HTTPS and DNS for ${label} and blocks again`, () => {
      const f = fixture();
      try {
        const result = deploy(f, opts);
        assert.equal(result.status, 0, result.stdout + result.stderr);
        assertNarrowWindow(f);
        assert.equal(rules(f.dir), f.before);
        assert.match(sudoCalls(f), /--version/);
        assert.equal(/ install /.test(sudoCalls(f)), !opts.lockSame);
      } finally {
        cleanup(f);
      }
    });
  }

  it('leaves the firewall alone when nothing needs downloading', () => {
    const f = fixture();
    try {
      const result = deploy(f, { lockSame: true, cached: true });
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.equal(calls(f), '');
      assert.equal(sudoCalls(f), '');
    } finally {
      cleanup(f);
    }
  });

  it('puts a time limit on the remote installs', () => {
    assert.match(src, /run_limited 900 sudo -u dac bash -c "cd '\$STAGE\/server' && '\$NPM' install/);
    assert.match(src, /run_limited 600 sudo -u dac bash -c "cd '\$STAGE\/server' && '\$NPM' --version/);
  });

  it('opens and closes the window on iptables with a bare -w', () => {
    const f = fixture();
    try {
      const result = deploy(f, { env: { FAKE_IPT_W: 'bare' } });
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assertNarrowWindow(f);
      assert.equal(rules(f.dir), f.before);
    } finally {
      cleanup(f);
    }
  });

  it('leaves Tailscale\'s own rules alone when the window rule is already gone', () => {
    const f = fixture(true);
    try {
      rmSync(path.join(f.dir, 'stage/scripts/block_internet_access.sh'));
      const result = deploy(f, { env: { FAKE_DROP_WINDOW: 'yes' } });
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.equal(rules(f.dir), f.before);
    } finally {
      cleanup(f);
    }
  });

  it('closes the window and discards the stage when the remote shell is killed', () => {
    const f = fixture(true);
    try {
      const result = deploy(f, { env: { FAKE_KILL_REMOTE: 'yes' } });
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stdout, /FATAL: dependency download failed/);
      assertNarrowWindow(f);
      assert.equal(rules(f.dir), f.before);
      assert.equal(existsSync(path.join(f.dir, 'stage')), false, 'the stage should be removed after the window closes');
    } finally {
      cleanup(f);
    }
  });

  for (const [label, env] of [
    ['the install fails', { FAKE_INSTALL: 'fail' }],
    ['the SSH session hangs up', { FAKE_HANGUP: 'yes' }],
  ] as Array<[string, NodeJS.ProcessEnv]>) {
    it(`blocks again when ${label}`, () => {
      const f = fixture();
      try {
        const result = deploy(f, { env });
        assert.equal(result.status, 1, result.stdout + result.stderr);
        assert.match(result.stdout, /FATAL: /);
        assertNarrowWindow(f);
        assert.equal(rules(f.dir), f.before);
      } finally {
        cleanup(f);
      }
    });
  }
});
