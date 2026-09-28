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
  the Pod. The stock installer and in-app updater install published code and
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
   `throwaway31265/free-sleep`, retaining the data directory. This removes
   Nightstand, not the Eight Sleep firmware. There is no in-app route back;
   use the [migration tool](../docs/COMING_FROM_FREE_SLEEP.md) to return.
   If the app is unavailable but SSH works, the corresponding Pod command is
   `systemctl start free-sleep-revert.service`.
4. **Restore Eight Sleep software.** Follow the model-specific firmware-reset
   [procedure](../INSTALLATION.md#how-to-revert-changes-and-go-back-to-using-your-eight-sleep-through-their-app).
   It is separate from restoring an application backup.

## Network behavior

The app checks this fork's release manifest on GitHub from the user's browser.
Browser internet access is separate from the Pod firewall. Deployment opens
Pod internet access for changed dependencies; the updater opens it for its
downloads and attempts to reapply the block afterward.

The firewall permits local access, established connections and time sync.
If `tailscaled` is active when the block script runs, it also permits outbound
UDP, DNS and HTTPS to any host. The rules remain until reapplied or changed;
they are not confined to Tailscale servers. See the
[remote-access guide](../docs/REMOTE_ACCESS.md) before changing Tailscale setup.

## Standing state to remember

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
