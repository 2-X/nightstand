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
| Browser | Playwright | 570 tests, plus 40 screenshot comparisons (24 theme, 16 layout) | The demo build at phone, tablet and laptop sizes | Chromium; WebKit for a subset |
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
- **Each look.** For each of the three looks in Settings > Bed and sides >
  Theme: Bed, Schedule, Sleep and Settings at phone and desktop width fit the
  screen and keep 44 pixel targets, Bed fits a 320 pixel phone, the research
  sheet fits, and fonts load from the app's own address. A further 24
  screenshot comparisons (three looks, four screens, two sizes) run only on
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
versions, boot recovery with an update marker, competing operations taking
one lock, and a service that won't stop. The usual check is that the Pod is
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

CI can't test hardware. These tables record hardware checks and their limits.

| When | Pod | Version | What was checked | Result |
| --- | --- | --- | --- | --- |
| Since July 2026 | Pod 5 | each release | Nightly use by me, with two sleepers | in use |
| September 2026 | Pod 3 (SD card) | 3.3.1, 3.3.2, 3.5.1 | Fixes from one owner's reports in [issue #1](https://github.com/LTimothy/nightstand/issues/1) | only 3.3.1 confirmed by that owner |

### Checks on my Pod 5

I ran these checks on my Pod 5. I backed up the application and database to
my computer and rehearsed the restore before changing anything. These
results cover one Pod 5 only.

| Check | What happened | Remaining gap |
| --- | --- | --- |
| Each side on and off | Both sides followed the controls, including the final check. | Controls with an empty database were not run. |
| Update, downgrade, rollback and roll forward | Each completed on the intended install with settings and schedules intact. A wrong checksum was refused. | Install in the release list was partly covered: the downgrade used the app, while some update requests used the API, as the button does. An update from 3.5.1 cannot check a release checksum. |
| Rollback while a side is on | The server refused without confirmation, and the app showed the warning and cancelled without starting. | This did not exercise every update and switch warning. |
| Free-space refusals | With the required space raised for the check, updates refused on either partition and the switch to upstream refused on the data partition. | The disks were not filled. The fork switch itself was not run. |
| Server crash and hang | A killed server restarted within 15 seconds. The health check restarted a hung server. | One Pod 5. |
| Health check during an update or a deliberate stop | It left the server alone. | One Pod 5. |
| One-time alarm while the server was stopped | After restart, Nightstand reported the alarm as missed because it had not been running. | Other missed-alarm reasons have automated tests. |
| Firmware off timers with the server stopped | A Rhythms night and a weekly night turned the side off about 5 minutes after the scheduled off time. "When I get up" turned it off about 15 minutes after the scheduled off time. | The 12-hour timer for a side turned on by hand was not observed. |
| "When I get up" with someone in bed | The side stayed on while I was in bed and turned off after I got up. | One Pod 5. |
| Pause resume | Ending a pause during the night resumed the side under Rhythms and the weekly schedule. Ending a weekly pause early also resumed it. | Pause expiry outside the night has automated tests only. |
| Change pause | Changing the end saved once, with no power-on in between. | One Pod 5. |
| Alarm taps and dismissal reading | The firmware handled double and triple taps during an alarm without changing the gesture counters, so the configured alarm tap action had no effect. In a later check, a double tap stopped a Nightstand alarm, its `dismissAlarm` counter rose, and Nightstand cleared its ringing state and logged the dismissal. | Timestamp units remain unverified. This did not check the app's separate Dismiss command. |
| Boot recovery after an interrupted update | A reboot with no marker did nothing. A hand-set marker cleared after the health check. After a power cut a few seconds after the server stopped for an update, the previous install came back healthy; recovery ran once about 40 seconds after power returned and cleared the marker. | The cut landed before the tree move. A cut during the move itself is covered only by automated tests. The interrupted update recorded no result, so the app's last result stayed at the previous run. |
| Installer operation lock | The installer refused before downloading or changing anything while a test process held the operation lock. | The holder simulated a competing operation. |
| Operation lock after reboot | Boot recreated the lock file with the expected owner and permissions. | One Pod 5. |
| Biometrics service | The stream service followed the Biometrics setting, including after a server restart and reboot. | One Pod 5. |
| Weekly power logging | Power-on was logged by name for a weekly night. | Power-off logging has automated tests only. |
| `fs-reset` and data restore | Nightstand restarted with empty settings and Biometrics off, and read temperatures from the bed. I restored the data and checked the controls afterwards. | Controls on the empty database were not run. The stream's autostart needed enabling by hand after that restore; the later service reconciliation check passed. |
| Hardware watchdog | I checked setup, removal, persistence across a reboot and recovery from a deliberate freeze. The frozen Pod reset after about 34 seconds. | Setup ran by hand using the fallback for a kernel without watchdog sysfs. An update preserved a pre-existing watchdog setting; automatic arming from an off state was not checked. |
| Overnight health after the checks | The schedules and services were healthy the next morning, with no missed alarms. | One Pod 5. |
| Network watchdog Wi-Fi recovery | Not exercised. | Whether a restart restores Wi-Fi remains unconfirmed. |
| Switch to upstream free-sleep and back | Not run. | The fork switch and migration tool still have only simulated runs for the full switch. |

The update checks used a local HTTPS test proxy serving the release
candidate and older releases. They checked the update logic, not the public
GitHub download path, redirects or caching. The proxy and its test
configuration were removed afterwards.

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
- The [hardware checks](#checks-on-my-pod-5) cover one Pod 5 and the cases
  listed. The remaining script failure paths are checked on copies on a
  computer, with the Pod's commands replaced.
- The firewall script is checked for the rules it writes, not with real
  network traffic.
- Browser tests run in Chromium, and a phone-size subset plus the layout
  check also run in WebKit (Safari's engine). Firefox isn't tested, and the
  browser tests use the demo's mock data, not a live Pod.
- Whether a network watchdog restart brings the Pod's Wi-Fi back isn't
  confirmed. The app's separate Dismiss command for a ringing alarm has
  not been confirmed by these hardware checks.
- The Biometrics tests check that the code does what it was designed to do
  with fixed inputs. Whether its numbers are right is a separate question,
  covered in [VALIDATION.md](VALIDATION.md). The newer vitals estimators'
  memory and CPU use was measured on a computer, not on a Pod.
- Few people run Nightstand, so the lack of problem reports says little.
