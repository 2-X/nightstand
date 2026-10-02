# Deployment and recovery notes

These are the maintainer's deployment procedures for a development Pod. For
normal published releases, use the [update instructions](../README.md#updating).
The examples below describe the maintainer's Pod 5 with SSH on port 8822.

## Recovery scope

Nightstand runs as a userspace application. Installation and deployment also
change services, permissions and network configuration. See the
[recovery notes](../README.md#what-happens-if-an-install-fails) for what to
check before installing.

## Rules for every change

- Deploy unpublished changes through `ops/deploy.sh`. Never edit code live on
  the Pod. The release installer and in-app updater install published code and
  can replace a development build.
- Deploy committed code from a clean checkout. The script ships `HEAD`, even
  with `--force`; it never includes uncommitted files.
- Run package tests, lint and typechecks, rebuild `server/dist` and
  `server/public` when source changes, and commit the output. Follow
  [CONTRIBUTING.md](../CONTRIBUTING.md#before-a-pull-request).
- Deploy while the bed is idle. The script refuses when either side is on
  unless `--force` is supplied.
- Read root scripts end to end before changing them. Keep SSH access working;
  do not change SSH ports, users, firewall INPUT rules or `/opt/eight` as part
  of an application deployment. Record deliberate service and sudoers changes
  in the repository.
- Check the deployment result, then confirm the running version and the
  controls affected by the change.

## Development deployment

Run these commands on your computer, from the repository root:

```bash
ops/deploy.sh --check
ops/deploy.sh
```

The script ships committed `HEAD`, stages dependencies, saves a backup and
replaces the application tree. It refuses a dirty checkout or a powered-on
bed side unless `--force` is supplied; that flag still deploys `HEAD`, not
uncommitted files. Deploy while the bed is idle and verify the intended
commit first. Run the package checks and rebuild committed output as
explained in [CONTRIBUTING.md](../CONTRIBUTING.md#before-a-pull-request).

The in-app updater installs published releases. For unpublished changes, use
the workflow above. [Hot reload](../server/README_SERVER.md#hot-reloading-on-the-pod)
and `scripts/deploy-dev.sh` do not include the same backup and rollback steps.

### What is backed up and checked

- The deploy backup contains an application archive (excluding server
  `node_modules`), LowDB settings/schedules, and a SQLite copy when available,
  under `/persistent/free-sleep-backups/<timestamp>_v<version>/`.
- The immediate previous tree is `/home/dac/free-sleep-prev`. A later deploy
  replaces it. The current script keeps five timestamped backup directories.
- The deploy preflight requires more than 1500 MB on `/` and 2000 MB on
  `/persistent`. Disk sizes vary; the maintainer's 5.9 GB and 15 GB partitions
  are observations from one Pod.
- The health check requires HTTP 200 from `/api/deviceStatus`, the expected
  version, a numeric left-side temperature and an active server service.
  A failed migration also fails deployment. Test affected controls separately.
- A failed health check attempts to restore the previous application tree.
  It does not reverse database migrations. Keep migrations additive so older
  code can read the newer schema. The saved database is a separate recovery
  option, not part of an automatic code rollback.

Keep working SSH access before changing services or firewall rules. Read
root scripts end to end, especially SSH configuration, firewall INPUT rules,
systemd units and sudoers entries. The installer, updater and deployment
scripts do not have identical failure handling; inspect their output rather
than treating a responding web page as complete recovery.

## Recovery options

The following SSH examples run on your computer. Replace `<POD_IP>` with the
Pod's address. They require root SSH access:

```bash
ssh -p 8822 root@<POD_IP> 'journalctl -u free-sleep -n 100'
ssh -p 8822 root@<POD_IP> 'systemctl restart free-sleep'
```

If restarting does not resolve the problem:

1. **Roll back the application.** Run `ops/rollback.sh` on your computer to
   restore the previous deployment tree. It checks that the device-status
   endpoint responds; check the version and controls yourself afterward.
2. **Restore older application code.** `ops/rollback.sh --list` lists backups;
   `ops/rollback.sh --from <backup-dir-name>` restores that archive and reuses
   installed dependencies. Database and LowDB restoration is a separate
   manual operation. Inspect compatibility before restoring data.
3. **Switch to upstream free-sleep.** Settings > Software can install
   `throwaway31265/free-sleep`, retaining the data directory and preparing
   compatible settings. It replaces the application, not every system change
   Nightstand made. Read the [switch limits](../docs/COMING_FROM_FREE_SLEEP.md#switching-to-upstream).
   There is no in-app route back;
   use the [migration tool](../docs/COMING_FROM_FREE_SLEEP.md) to return.
   If the app is unavailable but SSH works, the corresponding Pod command is
   `systemctl start free-sleep-revert.service`.
4. **Restore Eight Sleep software.** Follow the model-specific firmware-reset
   [procedure](../INSTALLATION.md#how-to-revert-changes-and-go-back-to-using-your-eight-sleep-through-their-app).
   It is separate from restoring an application backup.

Pods migrated with the 3.3.1 tool can lack permissions or units for Roll back,
Switch to upstream, and turning biometrics off. The app reports the missing
prerequisite. A successful update installs the missing rules and units.

### Restore a database snapshot

In-app updates and switches save consistent SQLite snapshots, including
committed WAL data, under `/persistent/free-sleep-database-backups/`.
Code-backup rotation does not delete these snapshots. Nightstand keeps the
newest three and any from the last week, and removes the rest on every run.
Only while free space on `/persistent` is under 512 MB does it remove more,
oldest first. It never removes the newest, or snapshots made by the migration
tool; remove those yourself once you have a verified recovery copy.
Older code backups can contain incomplete databases if data was still in WAL;
check their contents before relying on them.

Restoring a snapshot replaces newer measurements with the saved data. Choose
a snapshot compatible with the installed code. Older and upstream trees lack
`sqlite-safety.py`; obtain a trusted copy from the retained Nightstand tree or
its code archive and set `SAFETY` to that path. Check it before stopping services.
Run the following as root on
the Pod while the bed is idle, replacing the example snapshot path:

```bash
set -e
DB=/persistent/free-sleep-data/free-sleep.db
SNAPSHOT=/persistent/free-sleep-database-backups/<chosen-snapshot>.db
SAFETY=/home/dac/free-sleep/scripts/sqlite-safety.py
test -f "$SNAPSHOT"
test -f "$SAFETY"
python3 -c 'import sqlite3'
systemctl stop free-sleep free-sleep-stream
python3 "$SAFETY" backup "$DB" "$DB.before-restore-$(date +%Y%m%d-%H%M%S)"
python3 "$SAFETY" checkpoint "$DB"
install -o dac -g dac -m 660 "$SNAPSHOT" "$DB.restore"
mv "$DB.restore" "$DB"
rm -f "$DB-wal" "$DB-shm"
systemctl start free-sleep
```

Restart `free-sleep-stream` only if biometrics was enabled before recovery.
Check the logs and the Sleep page afterward. Settings and schedules are in
the separate `lowdb/` backup; restoring code or SQLite does not restore them.
The migration tool's `--restore` also restores code only.

### Failed database migrations

A Prisma `P3009` error means a previous migration did not finish. Do not reset
the database or repeatedly mark that migration as rolled back. Older shipped
migrations were not transactional and may have left partial tables.

The updater resolves a verified P3009 failure once, then retries deployment,
after checking its checksum and transaction wrapper. For manual recovery, stop the server and streamer,
save a database snapshot as above, and run the trusted helper (adjusting its
path if Nightstand is no longer installed):

```bash
python3 /home/dac/free-sleep/scripts/sqlite-safety.py recoverable-migrations \
  /persistent/free-sleep-data/free-sleep.db \
  /home/dac/free-sleep/server/prisma/migrations
```

If it succeeds, use each printed migration name with
`npx dotenv -e .env.pod -- npx prisma migrate resolve --rolled-back <name>`
from the server directory, then run `npx dotenv -e .env.pod -- npx prisma
migrate deploy`, `npx prisma generate`, and `npx dotenv -e .env.pod -- npx
prisma migrate status` before restarting. These checks target the selected
Nightstand migration directory; do not use an older fork's `npm run migrate`,
which may invoke Prisma's development/reset workflow.
If the check refuses recovery, inspect the failed SQL and database together,
or restore a compatible snapshot. A code rollback alone cannot repair a
partial database migration.

## Network behavior

The app checks this fork's release manifest on GitHub from the user's browser.
Browser internet access is separate from the Pod firewall. Deployment opens
Pod internet access for changed dependencies; the updater opens it for its
downloads and attempts to reapply the block afterward.

The current updater applies the installed version's firewall after a
successful swap; rollback applies the restored version's rules. Downgrading
therefore restores older firewall behavior, including broader outbound
access and the older Pod 3 connection handling, until updated again.

Current downgrade and rollback paths preserve configured RAW retention when
installing an older archive script, or stop before swapping if they cannot.
Moves from 3.3.x to 3.2.x made by those older versions still revert to 36-hour
retention and can delete older sensor archives. Older versions also do not
honor features introduced later, including the presence auto-off toggle.

The firewall permits local access, established connections and time sync.
If `tailscaled` is active when the block script runs, it also permits outbound
UDP, DNS and HTTPS to any host. The rules remain until reapplied or changed;
they are not confined to Tailscale servers. See the
[remote-access guide](../docs/REMOTE_ACCESS.md) before changing Tailscale setup.

## Standing state to remember

The hardware-watchdog helper is manual. Install, update and migration do not
arm it. Automatic activation is a separate future change. There is still no
verified Pod 5 firmware-reset procedure.

- The development Pod is a Pod 5 on the local network, with root SSH on port
  8822.
- Live code is at `/home/dac/free-sleep`; the previous deployment is at
  `/home/dac/free-sleep-prev`, and failed deployments go to
  `/home/dac/free-sleep-failed`.
- Backups are under `/persistent/free-sleep-backups/<timestamp>_v<version>/`.
- The firewall normally blocks most Pod internet access. Deployment opens it
  for changed dependencies, then reapplies the rules described above.
- Release checks run in the browser against this fork's GitHub manifest and
  follow the saved channel. The Pod firewall does not block browser requests.
