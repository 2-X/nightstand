# Coming from free-sleep

Nightstand is a fork of free-sleep. If you already run
[throwaway31265/free-sleep](https://github.com/throwaway31265/free-sleep),
[jmew/free-sleep](https://github.com/jmew/free-sleep), or another fork on your
Pod, this page explains what you would be moving to and how to move without
losing anything.

## What stays the same

Nightstand keeps the free-sleep on-disk layout on purpose. The install still
lives at `/home/dac/free-sleep`, the services are still `free-sleep.service`
and `free-sleep-stream.service`, and your data still lives under
`/persistent/free-sleep-data/` (the SQLite database, the lowdb JSON, and the
logs). Nothing about the hardware changes, and the move is fully reversible
with a firmware reset, the same as any free-sleep install.

## What is different here

Nightstand is tuned for running one Pod well rather than being a
general-purpose platform, and a few choices follow from that:

- **Local-first, no telemetry.** There is no error-reporting integration and
  no analytics. The Pod only reaches the internet during an update, and version
  checks run from your browser rather than the Pod.
- **Its own version stream and update system.** Versions start at 3.0.0
  and are published through an in-app updater with update channels, a version
  picker, instant rollback, and automatic health-checked rollback on a failed
  install.
- **Evidence-based sleep features.** Presence detection, the sleep score, and
  the temperature features are built to be inspectable and honest about their
  limits. The changelog documents root causes, not just symptoms, including the
  things that are known to be imperfect.

## How to move your Pod over

Nightstand ships a migration tool built for exactly this. It is
safety-obsessed: it identifies your Pod read-only first, reports what it found
and what it would do, requires a typed confirmation, and backs up your code and
data both on the Pod and pulled to your laptop (integrity-verified in both
places) before it changes anything. A data-compatibility dry run loads your
existing settings and schedules through Nightstand's schemas and aborts if it
finds a real incompatibility. A dead-man sentinel auto-restores your original
fork within minutes if the install is interrupted.

See the "Switching from another free-sleep fork" section in
[INSTALLATION.md](../INSTALLATION.md) for the exact steps. Run it with
`--dry-run` first.

## Where issues go

Issues with Nightstand's own changes belong in this repository. Issues with the
projects it descends from belong upstream: the original project keeps a
community [Discord](https://discord.gg/JpArXnBgEj), and its fork history is
worth reading if you want the fuller story of how local Pod control came to be.
