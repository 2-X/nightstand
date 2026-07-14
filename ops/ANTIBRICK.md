# Never-brick workflow for the pod

This fork (LTimothy/nightstand) is deployed to the pod from a computer on the
LAN via `ops/deploy.sh`. This doc is the safety doctrine: why the pod is hard
to brick, what the *actual* risks are, and the rules that keep every change
recoverable.

## Why a true brick is nearly impossible

free-sleep is a **userspace app**. It never touches the bootloader, kernel,
partitions, or Eight Sleep's own firmware (`/opt/eight`, the "franken" stack).
Temperature control runs in Eight Sleep's firmware, if the free-sleep server
crashes or stops, **the bed keeps doing whatever it was last told**; only the
API/schedules/alarms pause. Pod 4/5 (and Pod 3 without SD card) can always be
recovered with an Eight Sleep firmware reset, which reinstalls the stock
system. That is the recovery floor: annoying, not fatal.

## The real risks, ranked

1. **Losing SSH access**, the only true "locked out" scenario short of a
   firmware reset. Never: change sshd config or port 8822, delete the root or
   rewt users, change their passwords casually, or add iptables **INPUT**
   rules. (`block_internet_access.sh` only filters OUTPUT, that's why it's
   safe to run.)
2. **The stock updater clobbering the fork**, the in-app update button runs
   `scripts/update.sh`, which reinstalls from upstream `throwaway31265/main`,
   wiping our changes. Our fork's `update.sh` has a guard at the top that
   makes it refuse to run. Keep that guard through merges.
3. **Filling a disk**, `/` (5.9G) hosts two full trees during deploys;
   `/persistent` (15G) holds backups, the DB, and the firmware's rolling RAW
   buffer. `deploy.sh` refuses to run below 1.5G / 2G free and prunes old
   backups (keeps 5).
4. **Bad server code crash-looping**, systemd restarts it forever; the bed
   is unaffected. Fix = `ops/rollback.sh` (seconds).
5. **Database damage from migrations**, deploy backs up `free-sleep.db` and
   the LowDB JSONs *before* every swap; installer-era copy also lives at
   `/persistent/free-sleep-data/free-sleep-copy.db`.
6. **Editing system files**, nothing we deploy should write outside
   `/home/dac/free-sleep*` and `/persistent/free-sleep-data|backups`. Treat
   the systemd unit files and sudoers entries as append-only, changed only
   deliberately and recorded in this repo.

## Rules for every change

- **Deploy only through `ops/deploy.sh`.** Never edit code live on the pod,
  never run the stock installer, never press the in-app update button.
- **Deploy only committed code** (`deploy.sh` ships git HEAD, a dirty tree
  aborts). Anything on the pod is reproducible from a commit hash.
- Before deploying: `npm run lint` and `npx tsc --noEmit` in `server/`,
  `npm run lint` and `npx tsc -b` in `app/`; rebuild `server/dist` and
  `server/public` if source changed (`npm run build:pr` in both) and commit
  the build output, the pod runs prebuilt code.
- **Deploy when the bed is idle.** `deploy.sh` aborts if either side is on
  (override with `--force` knowingly). Total downtime is seconds, but
  schedules/alarms don't fire while the server is down.
- Never edit `scripts/*.sh` that run as root on the pod without reading them
  end-to-end first; never touch `setup_ssh.sh` behavior, firewall INPUT
  rules, or anything under `/opt/eight`.
- After deploying, confirm the deploy script's health check passed (it
  verifies HTTP 200, the expected version, and live sensor data, and rolls
  back automatically if not).

## Recovery ladder (least → most drastic)

1. `ssh eight-pod 'journalctl -u free-sleep -n 100'`, read the crash.
2. `ssh eight-pod 'systemctl restart free-sleep'`, transient failures.
3. `ops/rollback.sh`, instant swap to the previous deploy.
4. `ops/rollback.sh --list` then `--from <name>`, restore an older backup
   (code + you can hand-restore its `free-sleep.db` / `lowdb/` copies).
5. Stock reinstall from upstream: on the pod, temporarily unblock WAN
   (`sh scripts/unblock_internet_access.sh`), run upstream's install.sh
   one-liner from INSTALLATION.md, re-block WAN. Loses fork changes, keeps
   data.
6. Eight Sleep firmware reset (see INSTALLATION.md), full stock recovery.

## Standing state to remember

- Pod: Pod 5 on the local network, SSH port 8822 (root user).
- Live tree: `/home/dac/free-sleep`; previous deploy: `free-sleep-prev`;
  failed deploys parked at `free-sleep-failed`.
- Backups: `/persistent/free-sleep-backups/<timestamp>_v<version>/`.
- WAN egress is normally **blocked** by iptables; deploys unblock/re-block
  automatically only when `npm install` is needed.
- The app's "update available" banner checks upstream's raw GitHub URL; with
  WAN blocked it silently fails. Updates come from this repo only.
