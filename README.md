<p align="center">
  <img src="docs/free-sleep-icon-rounded.svg" width="88" alt="Nightstand">
</p>

<h1 align="center">Nightstand</h1>

<p align="center"><b>Local control for Eight Sleep Pods. No cloud, no subscription.</b></p>

<p align="center">
  <a href="LICENSE.md"><img src="https://img.shields.io/badge/license-MIT-blue" alt="License: MIT"></a>
  <a href="CHANGELOG.md"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2FLTimothy%2Fnightstand%2Fmain%2Fserver%2Fsrc%2FserverInfo.json&query=%24.version&label=version" alt="Version"></a>
</p>

Eight Sleep Pods 3, 4, and 5 contain a small Linux computer. Nightstand runs a
server on it, so the Pod can be controlled from your own network without the
official app or Eight Sleep's cloud.

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

| Pod | Status | Notes |
| --- | --- | --- |
| Pod 1, Pod 2 | Not supported | |
| Pod 3 (with SD card) | Supported | Installed with a community SD card method rather than the serial cable. See [INSTALLATION.md](INSTALLATION.md#compatibility). Not tested by the maintainer; support follows upstream free-sleep. |
| Pod 3 (no SD card) | Supported | FCC ID `2AYXT61100001`, on the back near the water tubing. Not tested by the maintainer; support follows upstream free-sleep. |
| Pod 4 | Supported | Not tested by the maintainer; support follows upstream free-sleep. |
| Pod 5 | Supported | Developed and tested on this model. |
| Pod 6 | Unknown | Released September 2026. No reports yet; please open an issue if you try it. |

## About this fork

Nightstand is a personal fork of
[free-sleep](https://github.com/throwaway31265/free-sleep), by way of
[jmew's fork](https://github.com/jmew/free-sleep). Local control of the Pod
exists because of those projects, and most of the code here is theirs (see
[Credits](#credits)). free-sleep remains the main project and has the largest
user base.

I maintain Nightstand on my own Pod 5, mostly fixing issues I run into day to
day. I don't have a Pod 3 or Pod 4 to test on, so reports from owners of those
models are especially useful. The main differences in this fork:

- **No error reporting.** Version checks run from your browser, and
  Nightstand only connects to the internet to download an update. The
  firewall rules in installation step 19 block most of the Pod's other
  internet access.
- **In-app updates.** Settings lists available releases. Installing one backs
  up the Pod, confirms it came back healthy, and rolls back automatically if
  not. You can also roll back manually or switch between stable and beta.
- **Independent versioning,** starting at 3.0.0. Changes from the original
  project are reviewed and brought in by hand, so upstream fixes can take some
  time to appear here.

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
router instead: `http://<POD_IP>:3000`. The Pod doesn't advertise itself in
Bonjour browsers, so enter the address directly.

To add it to an iPhone home screen, open it in Safari, tap Share, then
**Add to Home Screen**. On Android, use Chrome's menu and choose
**Add to Home screen** or **Install app**. The app talks to the Pod directly,
so it keeps working during internet outages but isn't reachable away from home
unless you set up [Tailscale](https://tailscale.com) (installation step 20).

## Features

- Temperature control in °F, °C, or the official app's -10 to +10 scale,
  with live updates
- Schedules for power on and off, overnight temperature changes, daily
  priming, and alarms with vibration patterns
- Sleep and health data: heart rate, HRV, breathing rate, movement, sleep
  stages, and a sleep score (see [Biometrics](#biometrics) for accuracy)
- Adjustable base control on Pod 4 and later, with presets and manual head and
  foot positioning
- Away mode, LED brightness, and time zone settings
- Full functionality without an internet connection

### Biometrics

Biometrics in free-sleep and its forks, including this one, are still early.
Heart rate is the only measurement that has been validated: the original
project compared it against reference devices (mostly Apple Watch) over 33
nights from 6 people (3 men, 3 women), and accuracy was somewhat lower for
women. HRV, breathing rate, sleep stages, and the sleep score have not been
validated and may be inaccurate, and none of it has been checked on a Pod 3 or
Pod 4.

| Across 33 nights | Average | Best | Worst |
| --- | --- | --- | --- |
| RMSE (beats per minute) | 2.88 | 1.45 | 7.63 |
| MAE (beats per minute) | 1.83 | 1 | 5.77 |
| Correlation | 80.8% | 95% | 27% |

Biometrics is off by default and requires a one-time install on the Pod:

```bash
sh /home/dac/free-sleep/scripts/enable_biometrics.sh
```

After that, it can be turned on and off under Settings > Features.

Data is stored on the Pod in `/persistent/free-sleep-data/free-sleep.db` and
is available from `http://<POD_IP>:3000/api/metrics/vitals`. See
[biometrics/BIOMETRICS.md](biometrics/BIOMETRICS.md) for details.

## Updating

Updates are under Settings > Software & updates. Installing an update
downloads the release, backs up the Pod's code and data, installs it, and rolls
back automatically if the health check fails. Running `fs-update` over SSH does
the same.

There are two release channels. Beta offers every release; stable offers a
release only after it has run without problems for a while. New installs start
on stable, so switch to beta to receive every update.

## FAQ

### Can I go back to the Eight Sleep app?

Yes. A firmware reset restores the stock software. See
[How to revert](INSTALLATION.md#how-to-revert-changes-and-go-back-to-using-your-eight-sleep-through-their-app)
in the install guide. The Pod 5 reset steps are not written up there yet.

### Could I brick my Pod?

I'm not aware of any bricked Pods on Pod 3 without an SD card, Pod 4, or
Pod 5, and a firmware reset restores the stock software if an install goes
wrong. There are fewer reports for Pod 3 with an SD card, which uses a
different method. As with any unofficial software, you install it at your own
risk.

### Will it void my warranty?

It may, since Eight Sleep doesn't support it. No hardware is modified, and a
firmware reset returns the Pod to its original state.

### Where can I get help?

[Open an issue](https://github.com/LTimothy/nightstand/issues) and include the
output of `fs-debug`, run on the Pod over SSH. If the problem also exists in
the original project, consider reporting it there as well.

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
  on, adding presence detection, sleep stages, one-off alarms, adjustable base
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

From the [demo](https://ltimothy.github.io/nightstand/), which uses sample
data.

<details>
<summary>Adjustable base</summary>
<img src="docs/elevation.png" width="360">
</details>
<details>
<summary>Schedules and alarms</summary>
<img src="docs/schedules.png" width="360">
</details>
<details>
<summary>Sleep stages, sleep score, and health metrics</summary>
<img src="docs/sleep.png" width="360">
</details>
<details>
<summary>System status</summary>
<img src="docs/status.png" width="360">
</details>
<details>
<summary>Settings</summary>
<img src="docs/settings.png" width="360">
</details>
