# Coming from free-sleep

Nightstand is a fork of [jmew/free-sleep](https://github.com/jmew/free-sleep),
which builds on the original
[throwaway31265/free-sleep](https://github.com/throwaway31265/free-sleep).
If your Pod already runs one of those, or another fork of free-sleep, a
migration tool can switch it to Nightstand without reinstalling from scratch.
This page covers what changes, what the tool does, and how to go back.

## What stays the same

Nightstand keeps free-sleep's on-disk layout to ease migration:

- The install lives at `/home/dac/free-sleep`.
- The services are `free-sleep.service` and `free-sleep-stream.service`.
- Your data stays under `/persistent/free-sleep-data/`: the SQLite database,
  the lowdb JSON files that hold settings and schedules, and the logs.

The migration checks settings and schedule formats before installation and
keeps the existing data. If the database check finds incompatible migration
histories, the tool stops and attempts to restore the original application.
Compare the two forks' migrations and resolve compatibility before retrying;
do not reset the database.

## What changes

- **Hardware.** I maintain Nightstand on my own Pod 5. On a Pod 3 or Pod 4,
  temperature control and scheduling are expected to work, but those models
  write sensor data in a different format and sleep tracking has not been
  tested there. The tool asks you to acknowledge this before it continues.
- **Internet access.** Nightstand sends no error reports or analytics. The app
  checks for versions from your browser. Migration applies the
  [firewall rules](../INSTALLATION.md#19-add-firewall-rules-to-block-internet-access-optional-but-recommended),
  blocking most new internet connections while allowing local access,
  established connections and time synchronization. If Tailscale is running
  when the script applies them, outbound UDP, DNS and HTTPS to any host are
  also allowed. These exceptions remain until the firewall is reapplied or
  changed, even if Tailscale stops. Rerun the script after changing Tailscale
  setup. The updater temporarily opens access for downloads.
- **Updates.** Versions start at 3.0.0. Settings > Software offers beta and
  stable channels, a version picker, and application rollback. Failed updates
  attempt to restore the previous application tree. This does not restore
  an earlier database or the Eight Sleep firmware.
- **Known limits.** The numbers behind presence detection and the sleep
  features are listed in [CALIBRATION.md](CALIBRATION.md), and the
  [changelog](../CHANGELOG.md) notes what is still known to be imperfect.

## Before you start

You need:

- A Mac or Linux computer with `curl`, `ssh`, `scp`, `tar`, and `python3`.
- The Pod's root password and SSH access on port 8822 or 22 (every fork's
  install sets this up).
- A current install that is running normally. The tool stops if
  `free-sleep.service` is not active.
- More than 2 GB free on the Pod's `/` and `/persistent` partitions, and on
  your computer for the backup copy.

## Running it

The full steps are in
[Switching from another free-sleep fork](../INSTALLATION.md#switching-from-another-free-sleep-fork).
On your computer, download all three scripts into the same folder. The main
script copies the two helpers to the Pod:

```bash
for f in switch-to-this-fork.sh pod-installer.sh restore-original-fork.sh; do
  curl -fO "https://raw.githubusercontent.com/LTimothy/nightstand/main/scripts/migrate/$f"
done
chmod +x switch-to-this-fork.sh
./switch-to-this-fork.sh --dry-run
```

If the report looks right, run `./switch-to-this-fork.sh` without
`--dry-run`. It finds the Pod at `eight-pod.local` or offers to scan your
network for it; pass `--ip <addr>` to skip that. `--help` lists the other
options.

## What the tool does

`switch-to-this-fork.sh` runs on your computer and works over SSH. In order,
it:

1. Checks the Pod read-only and prints a report of what it found and what it
   would do. With `--dry-run` it stops here.
2. Waits for you to type `switch`. It then offers clock correction if needed;
   dry-run mode skips both prompts.
3. Backs up application code and installed server dependencies, the SQLite
   database and LowDB settings/schedules to `/persistent/free-sleep-backups/`
   on the Pod. It copies the archive to the folder you ran the tool from and
   checks both archives. Logs and RAW sensor archives are not included.
4. Downloads the newest Nightstand release on the Pod and checks your
   current settings and schedules against Nightstand's formats. It stops if
   anything can't carry over, before your install is touched.
5. Swaps the new install in, keeps your old one at
   `/home/dac/free-sleep-prev`, checks HTTP/device status and the expected
   version, and applies the firewall rules described above. Check your usual
   controls afterward.

The work on the Pod runs in the background, so closing your computer partway
through doesn't interrupt it.

## What it risks

Migration replaces application files and adjusts services and firewall rules.
Before swapping code, the tool arms a timer that attempts to restore the
original application if installation has not completed within 12 minutes.
Read the [recovery notes](../README.md#what-happens-if-an-install-fails)
before starting.

If either side of the bed is on, the tool asks you to type a confirmation
before going ahead.

## Going back

- **To your previous install:** Settings > Software has a Roll back
  action. Right after migrating, it rolls back to your old install. Installing
  any other Nightstand version replaces that slot, so use the laptop backup
  after that.
- **From the backup on your computer:** this works even if the web app is
  down, as long as SSH works.
  ```bash
  ./switch-to-this-fork.sh --restore <backup-tarball> --ip <POD_IP>
  ```
  Restore checks the archive before stopping the app and keeps the replaced
  tree at the path it prints. Archives from older tools that omitted
  `server/node_modules` are refused; use Roll back if the previous install
  is still available.
- **Switch to upstream free-sleep:** the action in Settings > Software
  replaces Nightstand with the current throwaway31265/free-sleep and retains
  the data directory, subject to upstream schema compatibility. It installs
  the original project, not jmew's or another fork. There's no button to come
  back afterward; run the migration tool again.
- **Restore Eight Sleep software:** reset the firmware as described in
  [INSTALLATION.md](../INSTALLATION.md#how-to-revert-changes-and-go-back-to-using-your-eight-sleep-through-their-app).
  This is separate from application rollback.

## Reporting problems

[Open an issue](https://github.com/LTimothy/nightstand/issues) with your Pod
model, Nightstand version, expected and actual behavior, and reproduction
steps. For installation or service problems, include relevant `fs-debug`
output. Check the report before posting it publicly and remove personal or
network details you do not want to share. If the problem also exists in the
original project, consider reporting it there too.
