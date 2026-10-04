import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
export const MB = 1024;
// What 3.5.1 measures: 47 MB unpacked, 330 MB of node_modules on arm64.
export const INSTALL = { tree: 48 * MB, modules: 330 * MB, db: 40 * MB };
// df and du answer only the exact flags the scripts use, so a change of units
// or flags shows up as a refusal rather than passing quietly.
export function writeFakeDiskTools(bin) {
    mkdirSync(bin, { recursive: true });
    writeFileSync(path.join(bin, 'df'), `#!/bin/sh
if [ "$#" -ne 2 ] || [ "$1" != -kP ]; then echo "fake df: unexpected arguments: $*" >&2; exit 2; fi
[ -z "\${FAKE_DF_SILENT:-}" ] || exit 1
case $2 in
  */persistent) avail=$FAKE_PERS_AVAIL_KB ;;
  *) avail=$FAKE_ROOT_AVAIL_KB ;;
esac
echo 'Filesystem 1024-blocks Used Available Capacity Mounted on'
echo "fake 99999999 1 $avail 1% $2"
`, { mode: 0o755 });
    writeFileSync(path.join(bin, 'du'), `#!/bin/sh
if [ "$#" -lt 2 ] || [ "$1" != -sk ]; then echo "fake du: unexpected arguments: $*" >&2; exit 2; fi
shift
for arg in "$@"; do
  case $arg in
    -*) echo "fake du: unexpected argument: $arg" >&2; exit 2 ;;
    */node_modules) kb=$FAKE_MODULES_KB ;;
    */free-sleep.db) kb=$FAKE_DB_KB ;;
    */free-sleep.db-wal) kb=\${FAKE_WAL_KB:-0} ;;
    */lowdb) kb=200 ;;
    *) kb=$((FAKE_TREE_KB + FAKE_MODULES_KB)) ;;
  esac
  printf '%s\\t%s\\n' "$kb" "$arg"
done
`, { mode: 0o755 });
    writeFileSync(path.join(bin, 'systemctl'), '#!/bin/sh\nexit 3\n', { mode: 0o755 });
}
// The environment that makes the fake tools report the given disk and install.
export function fakeDiskEnv(bin, disk) {
    const install = disk.install ?? INSTALL;
    return {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        FAKE_ROOT_AVAIL_KB: String(disk.rootFreeMb * MB),
        FAKE_PERS_AVAIL_KB: String(disk.persFreeMb * MB),
        FAKE_TREE_KB: String(install.tree),
        FAKE_MODULES_KB: String(install.modules),
        FAKE_DB_KB: String(install.db),
        FAKE_WAL_KB: String(install.wal ?? 0),
        FAKE_DF_SILENT: disk.silentDf ? '1' : '',
    };
}
//# sourceMappingURL=fakeDisk.js.map