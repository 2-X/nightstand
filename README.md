<p align="center">
  <img src="docs/free-sleep-icon-rounded.svg" width="88" alt="Nightstand">
</p>

<h1 align="center">Nightstand</h1>

<p align="center"><b>Local control for Eight Sleep Pods, without the Eight Sleep app or subscription.</b></p>

<p align="center">
  <a href="LICENSE.md"><img src="https://img.shields.io/badge/license-MIT-blue" alt="License: MIT"></a>
  <a href="CHANGELOG.md"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2FLTimothy%2Fnightstand%2Fmain%2Fserver%2Fsrc%2FserverInfo.json&query=%24.version&label=version" alt="Version"></a>
</p>

<p align="center">
  <img src="docs/hero.png" width="800" alt="The Bed, Schedule and Sleep screens of the Nightstand app">
</p>

Nightstand runs on the Linux computer inside compatible Eight Sleep Pods,
providing local temperature controls, schedules and optional sleep estimates.
It is a personal fork of free-sleep through jmew's fork, maintained on a Pod 5.
See the compatibility table for other models and the biometrics notes for
measurement limits.

<p align="center">
  <img src="docs/on.png" width="240" alt="Temperature control, device on">
  &nbsp;&nbsp;
  <img src="docs/off.png" width="240" alt="Temperature control, device off">
</p>

**[Try the live demo](https://ltimothy.github.io/nightstand/)**: the full app
running in your browser against sample data, with nothing to install.

Nightstand is not affiliated with, endorsed by, or supported by Eight Sleep,
Inc. "Eight Sleep" and "Pod" are used only to identify compatible devices.

## Compatibility

The maintainer tests Nightstand on a Pod 5. Pod 3 and Pod 4 support comes
from upstream free-sleep; this fork's biometrics and base controls have not
been tested on those models.

New sleep tracking (beta) has been checked against sleepers' own notes only on
a Pod 5 whose cover writes `capSense2` capacitance records. On any other model,
whatever format it writes, and on a Pod 5 whose cover writes the older
`capSense` records, it is experimental, has not been checked against anyone's
sleep, and Settings > Features says "Experimental on this Pod". A Pod 5 whose
cover writes the older format shows the label only after its first calibration
with the switch on. On a Pod whose capacitance format it does not recognize,
the switch leaves sleep tracking as it was and notes this in the log.

| Pod | Temperature and schedules | Biometrics | Adjustable base |
| --- | --- | --- | --- |
| Pod 1, Pod 2 | Not supported | Not supported | Not supported |
| Pod 3 (with SD card) | Upstream support; uses the [SD card method](INSTALLATION.md#compatibility) | Untested on this fork; new sleep tracking experimental | Untested on this fork |
| Pod 3 (no SD card) | Upstream support; FCC ID `2AYXT61100001` | Untested on this fork; new sleep tracking experimental | Untested on this fork |
| Pod 4 | Upstream support | Untested on this fork; new sleep tracking experimental whatever capacitance format it writes | Requires an adjustable base |
| Pod 5 | Tested by maintainer | Experimental estimates | Requires an adjustable base; no separate test report |
| Pod 6 | Unknown | Unknown; new sleep tracking untested | Unknown |

## About this fork

Nightstand is a personal fork of
[free-sleep](https://github.com/throwaway31265/free-sleep), by way of
[jmew's fork](https://github.com/jmew/free-sleep). Local control of the Pod
exists because of those projects, and most of the code here is theirs (see
[Credits](#credits)). free-sleep remains the main project and has the largest
user base.

I maintain Nightstand on my own Pod 5, mostly fixing issues I run into day to
day. Reports from owners of Pod 3 and Pod 4 are especially useful. Nightstand
has no error reporting or analytics; its browser checks versions on GitHub
([tested](app/e2e/privacy.spec.ts)).
Daily use is local, with the [firewall exceptions](INSTALLATION.md#19-add-firewall-rules-to-block-internet-access-optional-but-recommended)
explained in the installation guide. In-app updates support release selection
and application rollback. Versions start at 3.0.0; upstream fixes are reviewed
and brought in by hand, so they may take time to appear here.

Already running another free-sleep fork? See
**[Coming from free-sleep](docs/COMING_FROM_FREE_SLEEP.md)**.

## Installing

Follow **[INSTALLATION.md](INSTALLATION.md)**. You'll need a Mac or Linux
computer and basic familiarity with a terminal. Most Pods require opening the
case and connecting a serial cable (about $70 in parts). Pod 3 with an SD card
doesn't need the cable; it uses a community SD card method, and the guide
explains where to pick up from there.

Once installed, the Pod serves the app on port 3000:

```
http://eight-pod.local:3000
```

If that address doesn't resolve (for example, the Pod was renamed or your
network doesn't support `.local` names), use the Pod's IP address from your
router instead: `http://<POD_IP>:3000`. Enter the address directly if the Pod
does not appear in Bonjour browsers.

Nightstand's API has no login: a device that can reach it can control the Pod
and access its data. Use a trusted local network, do not port-forward it to
the public internet, and restrict access if you enable Tailscale.

To add it to an iPhone home screen, open it in Safari, tap Share, then
**Add to Home Screen**. On Android, use Chrome's menu and choose
**Add to Home screen** or **Install app**. The app talks to the Pod directly,
so it keeps working during internet outages but isn't reachable away from home
unless you set up [remote access with Tailscale](docs/REMOTE_ACCESS.md).

## Features

- Temperature control in °F, °C, or the official app's -10 to +10 scale,
  with live updates
- Schedules for power on and off, overnight temperature changes, daily
  priming, and alarms with vibration patterns, and a pause for one side
  for tonight, until a set time or until you resume
- Rhythms (beta, off by default): named sleep plans for each side, a week
  that picks one for each day, and changes for single dates up to 60 days
  ahead, with an optional Smart Schedule temperature curve
- Sleep and health data: heart rate, HRV, breathing rate, movement, sleep
  stages, and a sleep score (see [Biometrics](#biometrics) for accuracy)
- Adjustable-base controls on compatible hardware, with presets and manual
  positioning; see the model table for test status
- Away mode, LED brightness, and time zone settings
- Daily controls and schedules work locally. Installation, update downloads
  and version checks use the internet; optional remote access uses Tailscale.

### What you can turn off

In Settings:

- **Biometrics** under Features: off by default, and needs a one-time install (see below).
- **Sleep score and stages** under Features: needs biometrics.
- **Presence auto-off** under Features: on by default, and needs biometrics. Turns a side off
  after 45 minutes with no one on it, outside its scheduled on-window.
- **New sleep tracking (beta)** under Features: off by default, needs biometrics. Uses
  the bed's capacitance sensors to tell the two sides apart (see
  [Biometrics](#biometrics)). It has only been checked on a Pod 5 writing the newer
  capacitance format; anywhere else it is experimental and the app says so.
- **Rhythms (beta)** under Features: off by default. The first time you turn it
  on, it copies the weekly schedule into named rhythms and keeps the weekly
  schedule as it is. After that, turning it on brings back your saved rhythms.
  Turning it off brings the weekly schedule back exactly as it was.
- **Level temperature display** and
  **one-time alarms** under Features: on by default.

Next to daily priming, the restart an hour before priming is on by default and
only runs while priming is on.

### Rhythms and Smart Schedule

With Rhythms on, the Schedule tab shows a Week, the coming dates and your
rhythms. A rhythm is one night: bedtime, wake time, alarms, turn off and
temperatures. The Week picks a rhythm, or no sleep, for each day, and any
date up to 60 days ahead can use a different one. Week and date changes save
at once and can be undone, and every date change is listed in one place. The
Bed page follows the same sleeps.

A rhythm sets its temperatures by hand or with Smart Schedule. Smart
Schedule follows a common pattern from sleep and temperature research:
comfortable when you lie down, a little cooler once you are asleep, and
warming gently before your wake time. Changes are small and gradual and
stay within a few steps of a base temperature you choose. With biometrics
on, the cool-down waits until you have settled in bed, up to two hours
after bedtime. A temperature you set by hand holds until the curve's next
phase, at most three hours. The step sizes and timings are our own
estimates: the studies listed in the app under "Based on sleep research"
used other beds and did not test this curve. It is a general starting
point, not a medical recommendation.

Turning Rhythms off, rolling back or switching to upstream free-sleep
leaves the weekly schedule as it was, and your rhythms are kept in their
own file for next time.

### Biometrics

Biometrics is experimental. The original free-sleep project compared heart-rate
estimates with reference devices across 33 nights from six people.
That comparison does not validate Nightstand's later changes. HRV, breathing
rate, sleep stages and sleep score have not been validated here and may be
inaccurate. This fork is developed on a Pod 5; its biometrics have not been
checked on Pod 3 or Pod 4. The [biometrics reference](biometrics/BIOMETRICS.md#upstream-heart-rate-comparison)
has the original comparison and its source.

On a Pod 5, the **New sleep tracking (beta)** switch changes how the Pod
decides who is in which side of the bed. The old method relied on the
vibration sensor, which picks up both sleepers at once, so a shared bed often
looked like one person coming and going. The new method uses the capacitance
sensor under each side, which only rises for the person lying on it. On one
night checked against both sleepers' own notes, it closely matched each
person's bed times and caught two short trips out of bed, where the old live
presence split the night into many pieces and the old nightly record gave
both sides the same times. It has only been checked on one Pod 5 so far.

On any other model, and on a Pod 5 that writes the older capacitance format,
the switch is experimental and does less. It changes the nightly sleep
records: these start from the Pod 5's entry level, or from 300 counts on the
older format (the entry level sleepypod uses for it), and then follow each
side's level as learned from the Pod's own nights. A side keeps the older
reading for a night whenever its capacitance had gaps, found a much shorter
night than the older rule, or came in two formats. Once both sides' levels are
learned and vibration readings arrive once a second, capacitance also decides
when heart rate and breathing are recorded, and the vibration sensor takes
that back if capacitance places nobody in a bed it reads as in use. The in-bed
indicator, presence auto-off and schedules that react to presence keep using
the vibration sensor, as with the switch off. None of this has been checked on
those Pods.

<p align="center">
  <img src="docs/presence-before-after.png" width="720" alt="Before and after: vibration and capacitance readings for each side, and when each side read as occupied under the old and new tracking">
</p>

Biometrics is off by default and requires a one-time install. On the Pod
over SSH:

```bash
sh /home/dac/free-sleep/scripts/enable_biometrics.sh
```

After that, it can be turned on and off under Settings > Features.

Data is stored on the Pod in `/persistent/free-sleep-data/free-sleep.db` and
is available from `http://<POD_IP>:3000/api/metrics/vitals`, which returns the
last 24 hours by default and up to 7 days per request with `startTime` and
`endTime` (see [server/API.md](server/API.md)). See
[biometrics/BIOMETRICS.md](biometrics/BIOMETRICS.md) for details.

## Updating

Updates are under Settings > Software. The updater saves
application code, SQLite data and settings before replacing the code. It
checks the running version, a device-status temperature reading and that the
server service is active, and attempts an application rollback if installation
fails. Check the running version and your usual controls after it returns;
the startup check covers only the signals above.

`fs-update` over SSH uses the same updater and saved channel preference.
Stable selects stable releases; beta includes both channels. A new install
saves stable as its preference, but the installation script downloads `main`,
which may contain a beta. Choose a release in Settings to change versions.
Installing another release replaces the immediate rollback slot. Application
rollback restores code, not an earlier database or the Eight Sleep firmware.

## FAQ

### Can I go back to the Eight Sleep app?

A firmware reset restores Eight Sleep's software. Follow the procedure
for your model in [How to revert](INSTALLATION.md#how-to-revert-changes-and-go-back-to-using-your-eight-sleep-through-their-app).
Pod 5 reset steps are not documented here yet. Switching to upstream
free-sleep from Settings installs another community application; it does not
restore Eight Sleep software.

### Could I brick my Pod?

I'm not aware of any bricked Pods on Pod 3 without an SD card, Pod 4, or
Pod 5. There are fewer reports for Pod 3 with an SD card, which uses a
different install method. If an install goes wrong, a firmware reset restores
Eight Sleep's software. Read the
[reset instructions for your model](INSTALLATION.md#how-to-revert-changes-and-go-back-to-using-your-eight-sleep-through-their-app)
before installing; Pod 5 reset steps are not documented here yet. Proceed
at your own risk.

### What happens if an install fails?

The updater and migration tool keep backups and try to restore the previous
application when startup fails. Recovery can still require SSH or a
[model-specific firmware reset](INSTALLATION.md#how-to-revert-changes-and-go-back-to-using-your-eight-sleep-through-their-app),
so check that procedure before installing. Schedules and alarms pause while
Nightstand's server is stopped.

### Will it void my warranty?

Eight Sleep does not support Nightstand. Check the warranty terms for your
Pod before installing.

### Where can I get help?

[Open an issue](https://github.com/LTimothy/nightstand/issues) with your Pod
model, Nightstand version, expected and actual behavior, and steps to reproduce.
For service or installation problems, `fs-debug` on the Pod over SSH can help.
Check the report before posting it publicly and remove any personal or
network details you do not want to share. If the problem also exists in the
original project, consider reporting it there as well.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Pull requests go to the `dev` branch.
There are separate notes for the [app](app/README_APP.md) and the
[server](server/README_SERVER.md).

## Credits

Nightstand builds on reverse-engineering work that others made public:

- [throwaway31265](https://github.com/throwaway31265/free-sleep) built the
  original project: the installer, the server, the app, and the biometrics
  pipeline.
- [jmew](https://github.com/jmew/free-sleep) built the fork this one is based
  on, adding presence detection, sleep stages, one-time alarms, adjustable base
  control, and live updates in the app.
- [@bobobo1618](https://github.com/bobobo1618) worked out how the Pod is
  controlled through `dac.sock`, which everything here depends on.

Smaller contributions are credited where they are used, in the
[changelog](CHANGELOG.md) and the docs.

## Related projects

Nightstand is one of several projects for running a Pod locally. If it isn't
the right fit, one of these may be:

- [free-sleep](https://github.com/throwaway31265/free-sleep), the original
  project, with the largest user base.
- [jmew/free-sleep](https://github.com/jmew/free-sleep), the fork Nightstand
  is based on.
- [sleepypod](https://github.com/sleepypod/core), an independent
  local-control project with a Next.js web app (AGPL-3.0) and an
  [iOS app](https://github.com/sleepypod/ios).
- [Lunaris](https://github.com/Schluggi/lunaris), firmware for the Pod built
  around Home Assistant and MQTT, forked from LiamSnow/opensleep.
- [hass-free-sleep](https://github.com/Mrtenz/hass-free-sleep), a Home
  Assistant integration for free-sleep.

If a project is missing, please open an issue.

## License

MIT, unchanged from the original project. [LICENSE.md](LICENSE.md) has the
full text and the original project's disclaimer. The software comes with no
warranty.

## Screenshots

These screenshots use sample data and show the Bed, Schedule, Sleep and
Settings layout. The hosted [demo](https://ltimothy.github.io/nightstand/)
follows the published release and may differ from this checkout. The
Schedule screenshot shows Rhythms, which is off by default.

<details>
<summary>Adjustable base</summary>
<img src="docs/elevation.png" width="360" alt="Bed elevation controls">
</details>
<details>
<summary>Schedule with Rhythms</summary>
<img src="docs/schedules.png" width="360" alt="Rhythms week, coming dates and rhythm list">
</details>
<details>
<summary>Rhythm editor with Smart Schedule</summary>
<img src="docs/rhythm-editor.png" width="360" alt="Rhythm editor with times first and a Smart Schedule preview">
</details>
<details>
<summary>Sleep stages, sleep score, and health metrics</summary>
<img src="docs/sleep.png" width="360" alt="Selected sleep night with sample estimates">
</details>
<details>
<summary>System status</summary>
<img src="docs/status.png" width="360" alt="System status with exceptions first">
</details>
<details>
<summary>Settings</summary>
<img src="docs/settings.png" width="360" alt="Settings category index">
</details>
