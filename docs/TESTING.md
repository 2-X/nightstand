# Testing

This page lists how Nightstand is checked: the automated tests, what CI runs
and when, what has been tried on a real Pod, and what isn't tested. I update
it at each release.

## Automated tests

The counts are approximate and change with every release. Each release's
notes link the CI run for its tag, with the exact results.

| Suite | Tool | About | What it covers | Runs on |
| --- | --- | --- | --- | --- |
| Server | node:test | 2,200 tests | Scheduling, Rhythms and Smart Schedule, alarms and missed alarms, the firmware's own off timers, the connection to the Pod's hardware, the API, the database and its migrations, and the shell scripts (below) | Node 24 |
| App | Vitest | 1,700 tests | Screens and flows against the same mock data as the demo | Node 24, jsdom |
| Biometrics | pytest | 800 tests | Presence, sleep records, calibration and the vitals estimators, with fixed inputs and pinned results | Python 3.9 and 3.10 |
| Browser | Playwright | 570 tests, plus 48 screenshot comparisons | The demo build at phone, tablet and laptop sizes | Chromium; WebKit for a subset |
| Scripts | node:test, Python unittest, shellcheck | included in the server count, plus 31 Python tests | Install, update, rollback, fork switch, reset, firewall, watchdog and health-check scripts, run against throwaway copies with the Pod's commands replaced | bash, Python 3 |

Python runs on 3.9 and 3.10 because those are the versions Pods use: 3.9 on a
Pod 3 set up with an SD card, 3.10 on the others.

### What the browser tests check

They drive the demo, which has no Pod behind it, in headless Chromium (and
a phone-size subset in WebKit). The main Chromium project uses Asia/Tokyo,
a time zone other than the demo's, so a check that only passes in Pacific
time fails there. The layout sweeps and WebKit use America/Los_Angeles.

- **Bed screen states.** 13 states of the Bed screen (on, off, cooling, at
  the warmest setting, at zero, waiting for you to get up, the same with a
  stale presence report, paused, away, in Fahrenheit, a change still saving,
  the Pod not answering, loading) at seven screen sizes, from a 320 pixel phone to a 1280 pixel laptop. Each keeps its
  controls where the "on" state has them, never scrolls sideways, and keeps
  every control at least 44 pixels each way.
- **Each look.** For each of the four looks in Settings > Bed and sides >
  Theme: Bed, Schedule, Sleep and Settings at phone and desktop width fit the
  screen and keep 44 pixel targets, Bed fits a 320 pixel phone, the research
  sheet fits, and fonts load from the app's own address. A further 32
  screenshot comparisons (four looks, four screens, two sizes) run only on
  Linux, in the same Playwright image CI uses, because fonts render slightly
  differently elsewhere.
- **Privacy.** While it opens the demo's screens and dialogs, a test fails if
  the app requests anything other than its own address and two files on
  GitHub: the release list and the changelog. Another checks that fonts and
  styles load without contacting any other site.
- **Flows.** Alarms and missed alarms, schedules and Rhythms, pausing,
  temperature, the update and roll back dialogs, keyboard use, logs and
  settings.

### What the script tests check

The scripts run as root on the Pod, so the tests run them on a computer
against throwaway folders, with commands such as `systemctl` and `iptables`
replaced by fakes that record what they were asked to do. They simulate the
failures the scripts must survive: an update killed partway through, a slow
restart, a full disk, a bad download, an interrupted swap of the old and new
versions, and a service that won't stop. The usual check is that the Pod is
left with one working version and its services running. Shellcheck also runs
over every script and fails CI on any error.

## What CI runs and when

[CI](https://github.com/LTimothy/nightstand/actions/workflows/ci.yaml) runs
on every pull request and on every push to `main` and `dev`. It runs:

- the server, app and Python tests (Python once on 3.9 and once on 3.10),
- the browser tests against a fresh demo build,
- lint for the server and app, and shellcheck for the scripts,
- a build of the server and app, and a check that the committed bundles
  match the source. Pods install those bundles, so on `main` a mismatch
  fails the run.

After each deploy of the [demo](https://ltimothy.github.io/nightstand/), a
separate smoke test opens the published demo at phone widths.

Every release from v3.0.1 to v3.5.1 passed all of its checks; I checked each
tag's results on GitHub.

## Running the tests yourself

From the repository root, with Node 24 and Python 3.9 or newer:

```bash
(cd server && npm ci && npm run generate && npm test)
(cd app && npm ci && npm test)
pip install -r scripts/python/requirements.txt pytest
python3 -m pytest biometrics/__tests__/ -q
python3 -m unittest discover -s scripts/tests
(cd app && npx playwright install chromium webkit && npm run build:demo && npx playwright test)
```

The app tests need the server's packages installed, because some screens
use the server's data checks. The screenshot comparisons skip themselves
off Linux. None of these commands contacts a Pod.

## Hardware checks

CI can't test hardware. Each row here is a check on a real Pod.

| When | Pod | Version | What was checked | Result |
| --- | --- | --- | --- | --- |
| Since July 2026 | Pod 5 | each release | Nightly use by me, with two sleepers | in use |
| September 2026 | Pod 3 (SD card) | 3.3.1, 3.3.2, 3.5.1 | Fixes from one owner's reports in [issue #1](https://github.com/LTimothy/nightstand/issues/1) | only 3.3.1 confirmed by that owner |

### Planned on my Pod 5, not yet run

I plan one daytime session on my own Pod 5 before I mark this release
stable, with both sides off and nobody in bed. A full backup goes to my
computer first, and I practise restoring it before anything changes. The
checks then run from least to most risky, and the first unexpected result
ends the session and puts the Pod back as it was.

| Check | What should happen | Result |
| --- | --- | --- |
| Each side on and off | The bed follows the app | not yet run |
| Update, roll back, update again, all from the app | Each ends on the right version with settings and schedules intact | not yet run |
| Update or roll back while a side is on | The server and the app ask first and do nothing until confirmed | not yet run |
| Too little free space on either partition | The update, and the switch to upstream, stop before changing anything, and the app shows why | not yet run |
| Nightstand crashes | It is running again within seconds | not yet run |
| Nightstand hangs | The health check restarts it within a few minutes | not yet run |
| An alarm is due while Nightstand is stopped | The app reports the missed alarm and why | not yet run |
| Nightstand stops during a scheduled sleep | The Pod turns the side off by itself, for a Rhythms sleep and for a weekly schedule | not yet run |
| "When I get up" | Kept on while someone is in bed; with Nightstand stopped, off within about 15 minutes | not yet run |
| `fs-reset` | Nightstand still reaches the bed afterwards; the data is then put back | not yet run |
| Hardware watchdog | It turns on, off and on again, survives a restart, and resets a deliberately frozen Pod | not yet run |
| Switch to upstream free-sleep and back | A separate, later session, only if I decide the risk is worth it | not planned yet |

Results, with the date and the firmware version, replace the last column
after the session. Anything skipped will say so here.

### Not tested on hardware by me

Pod 3, Pod 4 and Pod 6, any adjustable base, and newer firmware that writes
sensor data only to a local stream.

## How a release becomes stable

A release starts on the beta channel and runs on my own Pod 5 before I mark
it stable. A change for another model is confirmed by an owner of that model
or marked unconfirmed in the changelog.

## Known gaps

- I have no Pod 3, Pod 4 or Pod 6. Changes for them are checked only by the
  tests here and, sometimes, by an owner.
- I have no adjustable base. The app's base screen is tested against the
  demo, but the server code that talks to a base has no tests of its own.
- Update, rollback, reset and the watchdogs are tested only with simulated
  failures until the hardware session above has run.
- The scripts are tested on copies on a computer, with the Pod's commands
  replaced, not on a Pod's own system image.
- The firewall script is checked for the rules it writes, not with real
  network traffic.
- Browser tests run in Chromium, and a phone-size subset plus the layout
  check also run in WebKit (Safari's engine). Firefox isn't tested, and the
  browser tests use the demo's mock data, not a live Pod.
- Whether a network watchdog restart brings the Pod's Wi-Fi back isn't
  confirmed, and the fix that stops a ringing alarm when it is dismissed
  hasn't been confirmed on hardware.
- The Biometrics tests check that the code does what it was designed to do
  with fixed inputs. Whether its numbers are right is a separate question,
  covered in [VALIDATION.md](VALIDATION.md). The newer vitals estimators'
  memory and CPU use was measured on a computer, not on a Pod.
- Few people run Nightstand, so the lack of problem reports says little.
