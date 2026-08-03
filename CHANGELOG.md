# Changelog

Notable changes to Nightstand, in its own version stream starting at 3.0.0
(see [CONTRIBUTING.md](CONTRIBUTING.md) for how versions get bumped). Nightstand
is a hard fork; for the history of the projects it descends from, see
[jmew/free-sleep](https://github.com/jmew/free-sleep) and
[throwaway31265/free-sleep](https://github.com/throwaway31265/free-sleep).

## [Unreleased]

- A physical double or triple tap that failed to write its temperature change
  restarted the server. Tap handling runs detached from the polling loop, so a
  base movement over Bluetooth cannot delay the next tap being noticed, but that
  also meant a failure had nowhere to go and the server treats an unhandled one
  as a reason to shut down. The failure is now caught where it happens, logged,
  and shown on the Status page.

## [3.0.1] - 2026-08-01

A bug-fix release. Most of it comes from one root cause: the app and the
server disagreed about which day a schedule ends on. The app asked whether
the off time falls before the on time, which is right. The server used a
fixed rule that a time at or before noon belongs to the next day, and never
looked at the on time at all. The presence monitor carried a third copy of
that rule. All three now share one model: a day's schedule opens at its
power-on time, so a time at or after that belongs to the same day and
anything earlier falls on the next one.

Fixed in the schedulers:

- A side could stay on for days. A Saturday 23:00 to 13:00 schedule put the
  power-off ten hours before its own power-on, so the next one to actually
  run was the following Saturday. A morning nap or an after-midnight
  schedule had smaller versions of the same problem.
- Alarms took their day from the power-off time rather than from the alarm's
  own time, so changing only when the bed switches off could move the alarm
  to a different weekday. The alarm then found the side already off and
  skipped itself, which looked like no alarm at all.
- Temperature adjustments could scatter one night's changes across three
  days, since each entry applied the old rule to a different time.
- An alarm saved without a time passed validation and then threw while being
  scheduled. Because every job was cancelled before the rebuild, one bad
  entry could leave the pod with no power, temperature, alarm, or priming
  jobs, and it stayed that way across restarts. Schedules are now validated
  more strictly, an unusable alarm is skipped rather than fatal, and each day
  is scheduled on its own so one failure cannot take down the rest.
- An alarm override accepted any text. "25:00" quietly armed the alarm for
  01:00 the next day. Override times and dates are now validated.
- A slow clock sync at boot could leave the pod with no jobs for the life of
  the process, because the retry budget ran out after 100 seconds and stopped
  for good. It now keeps retrying on a longer interval.
- The daily reboot silently never scheduled when priming was set before
  01:00, because the hour worked out to -1.
- Powering on no longer overwrites a temperature you set by hand while the
  temperature schedule is paused.

Fixed in presence auto-off:

- Auto-off treated "no presence data" as "nobody there" and could switch a
  side off with someone in it, 45 minutes after the biometrics stream stopped
  reporting. Turning biometrics off in settings stops that stream, so this
  was reachable from the app. Presence is now three states, and auto-off
  holds when it is unknown rather than assuming an empty bed.
- A clock correction after boot read as hours of absence and switched a side
  off on the next check.

Fixed in the app:

- Dismissing a vibrating alarm latched the dialog closed, so the next alarm
  did not show one.
- Several controls kept an optimistic value after the save failed, showing a
  temperature, power state, or away-mode setting the pod never accepted.
- The sleep chart labelled times like "22:30pm" and could put the wrong
  weekday under a bar.
- A schedule with alarms saved in the older single-alarm shape always looked
  edited, so discard never went quiet.
- A malformed settings response could blank the whole app instead of one
  section, and an invalid live-update frame could write over the cached
  device status and show the bed as off.

Also in this release:

- Settings now links to Software and updates, which was built and routed but
  had no way in. Its version picker and instant rollback were gated behind a
  version floor that no release had reached, so both were unavailable; the
  floor now sits at 3.0.0, where the features it guards actually shipped.

Known limitation, not fixed here: on the spring daylight-saving change, a job
scheduled in the hour that does not exist that day is skipped, and a weekly
job skips a full week rather than a day. The autumn case, where an alarm
could fire twice, is fixed. Addressing the spring case means replacing the
recurrence rules with explicit per-day scheduling, which is a larger change
to safety-critical code than belongs in a patch release.

## [3.0.0] - 2026-07-16

Nightstand's first release under its own identity: a minimal agent that
turns a stock free-sleep install into one with update, rollback, and
revert-to-stock built in. Everything else that has landed on top of that
agent so far, Franken hardening, biometrics, the sleep and schedule
pages, the updater surface, ships in this same tree today, and becomes
the first flag-gated feature bundle in a later release once the flag
system exists.

The git history itself was rebuilt from a fresh clone of upstream
throwaway31265/free-sleep, with each prior feature ported or
reimplemented as its own commit, attributed to its original author
wherever a commit could be taken directly. See [README.md](README.md)
for the fork lineage and [CONTRIBUTING.md](CONTRIBUTING.md) for how
versions get cut.
