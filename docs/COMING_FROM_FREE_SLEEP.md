# Coming from free-sleep

Nightstand is a fork of [jmew/free-sleep](https://github.com/jmew/free-sleep),
which builds on the original
[throwaway31265/free-sleep](https://github.com/throwaway31265/free-sleep).
If your Pod already runs one of those, or another fork of free-sleep, a
migration tool can switch it to Nightstand without reinstalling from scratch.
This page covers what changes, what the tool does, and how to go back.

## What stays the same

Nightstand keeps free-sleep's on-disk layout, so it stays compatible with
other forks' tooling:

- The install lives at `/home/dac/free-sleep`.
- The services are `free-sleep.service` and `free-sleep-stream.service`.
- Your data stays under `/persistent/free-sleep-data/`: the SQLite database,
  the lowdb JSON files that hold settings and schedules, and the logs.

Your settings, schedules, and sleep data carry over.

## What changes

- **Hardware.** I maintain Nightstand on my own Pod 5. On a Pod 3 or Pod 4,
  temperature control and scheduling are expected to work, but those models
  write sensor data in a different format and sleep tracking has not been
  tested there. The tool asks you to acknowledge this before it continues.
- **Internet access.** Nightstand sends no error reports or analytics, and the
  app checks for new versions from your browser, not from the Pod. At the end
  of the switch, the tool turns on Nightstand's firewall rules
  (`scripts/block_internet_access.sh`). They allow your local network and
  block most outbound traffic, but still allow DNS, time sync, outbound UDP,
  and HTTPS to any host, which Tailscale needs. The updater lifts the rules
  while it downloads a release and puts them back afterward.
- **Updates.** Versions start at 3.0.0. Settings > Software & updates offers
  beta and stable channels, a version picker, and a roll back button. An
  update that fails its health check restores the previous version on its
  own.
- **Known limits.** The numbers behind presence detection and the sleep
  features are listed in [CALIBRATION.md](CALIBRATION.md), and the
  [changelog](../CHANGELOG.md) notes what is still known to be imperfect.

## Before you start

You need:

- A Mac or Linux computer with `curl`, `ssh`, `scp`, `tar`, and `python3`.
- The Pod's root password and SSH access on port 8822 or 22 (every fork's
  install sets this up).
- A current install that is running normally. The tool stops if
  `free-sleep.service` isn't active, because it can only promise to return
  you to a working install.
- More than 2 GB free on the Pod's `/` and `/persistent` partitions, and on
  your computer for the backup copy.

## Running it

The full steps are in
[Switching from another free-sleep fork](../INSTALLATION.md#switching-from-another-free-sleep-fork).
The tool is three scripts that need to sit in the same folder, since it copies
the other two to the Pod:

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
2. Waits for you to type `switch`. Nothing on the Pod changes before this,
   except the clock if it offers to correct it and you agree.
3. Backs up your code and data to `/persistent/free-sleep-backups/` on the
   Pod, copies the backup to the folder you ran the tool from, and checks
   both copies.
4. Downloads the newest Nightstand release on the Pod and checks your
   current settings and schedules against Nightstand's formats. It stops if
   anything can't carry over, before your install is touched.
5. Swaps the new install in, keeps your old one at
   `/home/dac/free-sleep-prev`, checks that the new one is healthy, and turns
   on the firewall rules described above.

The work on the Pod runs in the background, so closing your computer partway
through doesn't interrupt it.

## What it risks

The tool doesn't touch the firmware or temperature control, so the bed keeps
doing what it was last told even if the web app is down. The main risk is an
install that stops partway. For that, a timer is set on the Pod just before
the swap. If the install hasn't finished within 12 minutes, the timer puts
your original install back on its own, even if the tool was killed or the
Pod lost power.

If either side of the bed is on, the tool asks you to type a confirmation
before going ahead.

## Going back

- **To your previous install:** Settings > Software & updates has a roll back
  button. Right after migrating, it rolls back to your old install. Installing
  any other Nightstand version replaces that slot, so use the laptop backup
  after that.
- **From the backup on your computer:** this works even if the web app is
  down, as long as SSH works.
  ```bash
  ./switch-to-this-fork.sh --restore <backup-tarball> --ip <POD_IP>
  ```
- **To the original free-sleep:** Settings > Software & updates > Revert to
  stock replaces Nightstand with the current throwaway31265/free-sleep and
  keeps your data. It installs the original project, not jmew's or another
  fork. There's no button to come back afterward; you would run the
  migration tool again.
- **To the Eight Sleep app:** reset the firmware as described in
  [INSTALLATION.md](../INSTALLATION.md#how-to-revert-changes-and-go-back-to-using-your-eight-sleep-through-their-app).
  This is the same as for any free-sleep install.

## Reporting problems

[Open an issue](https://github.com/LTimothy/nightstand/issues) here, including
for code that came from upstream, and include the output of `fs-debug`. If the
problem is also in the original project, it may be worth reporting there
too.
