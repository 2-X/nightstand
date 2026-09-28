# Requirements

## Compatibility

- Pod 1: not compatible
- Pod 2: not compatible
- Pod 3 (with SD card): works for most people who have tried it.
  - Use Linux for this.
    - Option 1: follow the steps [here](https://blopker.com/writing/04-zerosleep-1/) to get root. Start from step 11 (skip step 12). Run step 11 as soon as you SSH in, or the pod will auto-update its firmware and disconnect you.
    - Option 2: try [this script](https://github.com/Pixel-Meister/freesleep_script/blob/main/modify_eight_sleep.sh) to modify the Eight Sleep SD card (not personally tested).
- Pod 3 (no SD card): compatible. FCC ID 2AYXT61100001 (on the back of the pod, where the water tubes plug in).
- Pod 4: compatible.
- Pod 5: compatible.

## Tools required

- [TC2070-IDC ($50)](https://www.tag-connect.com/product/tc2070-idc). You can also solder the three required wires to the JTAG header instead.
- [FTDI FT232RL ($13)](https://www.amazon.com/gp/product/B07TXVRQ7V/)
- [Dupont wires ($7)](https://www.amazon.com/Elegoo-EL-CP-004-Multicolored-Breadboard-arduino/dp/B01EV70C78)

These steps are written for Mac and Linux. If you're on Windows, you'll need to adapt them yourself.

---

## How to revert changes and go back to using your Eight Sleep through their app

1. If your pod is already added to your Eight Sleep account in the app, open the app, manage the pod, and remove it from your account.
2. Reset the firmware:
   - [Pod 3](docs/pod_3_teardown/6_firmware_reset.jpeg)
   - [Pod 4](docs/pod_4_teardown/3_reset_firmware.png)
3. Set up the pod as a new pod in the app.

---

## Switching from another free-sleep fork

If your pod is already running a free-sleep fork (the original project, or
another fork) and you want to move to this one, use the migration tool
instead of a manual reinstall. It's a laptop-side script that connects to
your pod over SSH, backs everything up (on the pod and pulled to your
laptop, both verified), installs this fork, and keeps your old install in
place as an instant-rollback slot.

1. Download the script (don't pipe it into `bash`, read it if you like,
   then run it):
   ```bash
   curl -O https://raw.githubusercontent.com/LTimothy/nightstand/main/scripts/migrate/switch-to-this-fork.sh
   chmod +x switch-to-this-fork.sh
   ```
2. Run it once with `--dry-run` to see a full report of what it found and
   what it would do, without changing anything:
   ```bash
   ./switch-to-this-fork.sh --dry-run
   ```
3. If the report looks right, run it for real:
   ```bash
   ./switch-to-this-fork.sh
   ```
   It requires SSH access to your pod (every fork's install needs this) and
   asks for explicit typed confirmation before touching anything.

Requires only `curl`/`ssh`/`scp`/`tar` on your laptop (macOS or Linux).
Supported on Pod 5 (this fork's primary target); Pod 3/4 are accepted with
an extra warning, since sleep-tracking accuracy there is unverified on this
fork. If anything goes wrong, your original install is restored
automatically. See the tool's own `--help` output for recovery options
(`--restore <backup-tarball>`) if you ever need them.

---
# Installation steps

## 1. Access the circuit board

1. Pod 5 only: set up your pod with the Eight Sleep app first, then continue.
2. Follow the teardown steps for your pod to get access to the circuit board:
   - [Pod 3](docs/pod_3_teardown)
   - [Pod 4](docs/pod_4_teardown) ([written instructions](docs/pod_4_teardown/instructions.md))

---

## 2. Connect to the device

1. Your pod should be unplugged at this point. It doesn't need to be connected to the mattress cover or to power yet.
2. Using Dupont wires, connect your tag-connect cable to your FTDI FT232RL, following the images in [docs/jtag/](docs/jtag/).
3. Connect the tag-connect cable to the circuit board:
   - [Pod 3](docs/pod_3_teardown/7_pod_3_board_connection.jpeg)
   - [Pod 4](docs/pod_4_teardown/2_circuit_board.png)
4. Connect the FTDI FT232RL to your computer.

---

## 3. Get minicom ready on your computer

- The baud rate is 921600.
- Run `ls /dev/tty*`. You should see your FT232RL listed as something like `tty.usbserial-B0010NHK`.
  ```bash
  minicom -b 921600 -o -D /dev/tty.usbserial-B0010NHK
  ```
- You should see this screen (at least on Mac). If you don't, run `ls /dev/tty*` again; your device may be listed under a different name.

![docs/installation/0_minicom.png](docs/installation/0_minicom.png)

---

## 4. Plug the power into the pod

Get ready to interrupt the boot when you see `Hit any key to stop autoboot` (Ctrl+C works).

![Interrupt](docs/installation/1_interrupt.png)

If you did it correctly, you'll see this:

![Interrupt success](docs/installation/2_shell.png)

---

## 5. Modify the boot environment

This gets us root access.

```text
# Verify that current_slot = a. If it isn't, go back and reset your pod's firmware.
# If it's still not a, open an issue on this repository.
printenv current_slot

# If current_slot=a:
setenv bootargs "root=PARTLABEL=rootfs_a rootwait init=/bin/bash"

run bootcmd
```

---

## 6. Mount the file system

```bash
# Mount /proc for process and system information
mount -t proc proc /proc

# Mount /sys for hardware and system-level information
mount -t sysfs sysfs /sys

# Mount /dev for device files (e.g. /dev/mmcblk0)
mount -t devtmpfs devtmpfs /dev

# Mount /run (optional, but useful for some runtime scripts)
mount -t tmpfs tmpfs /run

# Remount the file system read-write (be careful editing files from here)
mount -o remount,rw /
```

---

## 7. Set the root and rewt passwords

```bash
passwd root
passwd rewt
```

---

## 8. Sync the file changes

```bash
sync
```

---

## 9. Reboot

**Do not interrupt this boot.**

```bash
reboot -f
```

---

## 10. Log in as root with the password you set

On Pod 4 and Pod 5 this screen looks slightly different; that's fine.

![Login](docs/installation/3_login.png)

---

## 11. Disable software updates

You may see failures saying some of these services were not loaded or don't exist; that's fine too.

```bash
# Disable the software updates
systemctl disable --now swupdate-progress swupdate defibrillator eight-kernel telegraf vector frankenfirmware dac swupdate.socket

# Block the software updates from starting again on restart or power-on
systemctl mask swupdate-progress swupdate defibrillator eight-kernel telegraf vector frankenfirmware dac swupdate.socket
```

---

## 12. Set up internet access

```bash
# Replace WIFI_NAME and PASSWORD with your actual Wi-Fi credentials
# (WIFI_NAME appears twice)
#
# Do not use a guest network or try anything fancy to keep the pod off the internet here.
# If you want to block internet access to the pod, we do that with firewall rules later (step 19).

nmcli connection add type wifi con-name WIFI_NAME ifname wlan0 ssid WIFI_NAME wifi-sec.key-mgmt wpa-psk wifi-sec.psk "PASSWORD" ipv4.method auto ipv6.method auto

# Optional: this takes your pod out of the "waiting to be set up" state and lets you turn off the blinking blue LED.
sed -i 's/uuid=.*/uuid=700a7a76-2105-4f46-b1b4-c9f3c791c440/' /persistent/system-connections/*.nmconnection

# Reload the network manager
nmcli connection reload
```

---

## 13. Install the Nightstand server

This installs the newest release and sets up a systemd service that starts
automatically on boot.

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/LTimothy/nightstand/main/scripts/install.sh)"
```

---

## 14. Get your pod's IP address

```bash
# Yours will be different, that's fine
nmcli -g ip4.address device show wlan0
192.168.1.50/24
```

---

## 15. Open the Nightstand web app

From a device on the same Wi-Fi network you set up in step 12, navigate to your pod's IP address on port 3000:

http://192.168.1.50:3000/

**Set your time zone, or scheduling will not work.** This is on the Settings page of the web app. The site should load, but it will look dulled out and stay that way until the pod is connected to the mattress cover.

![Web App](docs/installation/4_web_app.png)

---

## 16. Save the Nightstand web app to your home screen

- Apple devices:
  - Open the site in Safari.
  - Tap the share icon in the bottom toolbar.
  - Select "Add to Home Screen".
  - Edit the name if you like, then tap Add.
  - The shortcut appears on your home screen like an app icon.
- Android devices:
  - Open the site in Chrome (or your default browser).
  - Tap the three-dot menu in the top-right corner.
  - Select "Add to Home screen" (sometimes shown as "Install app").
  - Edit the name if you like, then tap Add.
  - The shortcut appears on your home screen like an app icon.

## 17. Validation

### Verify the site is still up

1. Unplug the power from your device and plug it back in.
2. Wait up to about four minutes, then check that you can still reach the site from another device.
3. If the site is up, you're good. The site will not fully load until the pod is connected to the mattress cover; once it is, it should load and work normally.

### Verify the controls work

1. Set up steps 18 and 19 below first (SSH access for debugging, and the firewall rules that block WAN traffic).
2. Disconnect the tag-connect cable and power from your pod.
3. Connect your pod to the cover as you normally would.
4. In the Nightstand web app, set a temperature (try the highest setting on one side and the lowest on the other).
5. Physically verify the temperature changes (lie on the cover, use a thermometer, whatever works).
6. If the temperature changes, you're set.
7. If it doesn't, open an issue on this repository and include the output of `fs-debug`.

## 18. Add an SSH config

This lets you set up remote access to your pod. SSH is on port 8822 (for example, `ssh root@<POD_IP> -p 8822`); it will ask for a public key.

```bash
sh /home/dac/free-sleep/scripts/setup_ssh.sh
```

## 19. Add firewall rules to block internet access (optional, but recommended)

```bash
sh /home/dac/free-sleep/scripts/block_internet_access.sh

# Undo this with
sh /home/dac/free-sleep/scripts/unblock_internet_access.sh
```

Blocking WAN access doesn't cost you updates: when a newer build of this
fork is published, the app's Settings page shows an Update button, and the
updater opens internet access just long enough to download before blocking
it again.

The block script's allowlist already includes Tailscale-friendly rules (the `tailscale0` interface, outbound UDP for WireGuard peers and STUN, TCP/443 for the Tailscale control plane and DERP relays, and DNS), so step 20 below works alongside the firewall.

---

## 20. (Optional) Remote access from outside your home network with Tailscale

By default the Nightstand web app is only reachable from your home Wi-Fi. If you'd like to monitor or control the pod when you're away, **Tailscale** adds the pod to a private WireGuard mesh: you reach it from your phone over an end-to-end-encrypted tunnel, with **no public internet exposure**. Free for personal use (100 devices or fewer).

The short version: install the Tailscale daemon on the pod, run `tailscale up` to log in, enable Tailscale Serve in the admin console, and then access the pod at `https://<pod>.<tailnet>.ts.net`.

### 20.1 Install the Tailscale daemon on the pod

If you've already run step 19, temporarily allow internet so the pod can fetch the tarball:
```bash
sh /home/dac/free-sleep/scripts/unblock_internet_access.sh
```

Then on the pod (as root):
```bash
# Pre-flight: confirm the kernel exposes /dev/net/tun
ls -la /dev/net/tun || modprobe tun

# Pick the latest aarch64 build from https://pkgs.tailscale.com/stable/#static
VERSION=1.96.4
TARBALL=tailscale_${VERSION}_arm64.tgz
cd /tmp
curl -fLO "https://pkgs.tailscale.com/stable/${TARBALL}"
curl -fsSL "https://pkgs.tailscale.com/stable/${TARBALL}.sha256" -o "${TARBALL}.sha256"
[ "$(awk '{print $1}' "${TARBALL}.sha256")" = "$(sha256sum "${TARBALL}" | awk '{print $1}')" ] \
  && echo OK || { echo CHECKSUM_MISMATCH; exit 1; }

# Install: binaries on rootfs, daemon state on the persistent partition (so
# the tailnet identity survives any future firmware events)
mkdir -p /opt/tailscale /persistent/tailscale-state
chmod 0700 /persistent/tailscale-state
tar -C /opt/tailscale --strip-components=1 -xzf "${TARBALL}"
ln -sf /opt/tailscale/tailscale  /usr/sbin/tailscale
ln -sf /opt/tailscale/tailscaled /usr/sbin/tailscaled
rm "${TARBALL}" "${TARBALL}.sha256"

# Default env file
cat > /etc/default/tailscaled <<'EOF'
PORT="41641"
FLAGS=""
EOF

# systemd unit. NOTE: `--statedir` is required separately from `--state`
# when using a custom state path. Without it, Tailscale's TLS cert
# subsystem fails with "no TailscaleVarRoot" and HTTPS won't work.
cat > /etc/systemd/system/tailscaled.service <<'EOF'
[Unit]
Description=Tailscale node agent
Documentation=https://tailscale.com/docs/
Wants=network-pre.target
After=network-pre.target NetworkManager.service systemd-resolved.service

[Service]
EnvironmentFile=/etc/default/tailscaled
ExecStart=/opt/tailscale/tailscaled --statedir=/persistent/tailscale-state --state=/persistent/tailscale-state/tailscaled.state --socket=/run/tailscale/tailscaled.sock --port=${PORT} $FLAGS
ExecStopPost=/opt/tailscale/tailscaled --cleanup
Restart=on-failure
RuntimeDirectory=tailscale
RuntimeDirectoryMode=0755
CacheDirectory=tailscale
CacheDirectoryMode=0750
Type=notify

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now tailscaled
systemctl status tailscaled   # expect: Active: running, "Needs login:"
```

### 20.2 Log the pod in to your tailnet

```bash
tailscale up --hostname=eight-pod --accept-routes=false --advertise-exit-node=false
```

Open the printed `https://login.tailscale.com/a/...` URL in any browser. If this is your first device, you'll create a free Tailscale account (sign in with Google, GitHub, Microsoft, or email). Approve the device. Back on the pod:

```bash
tailscale status     # should show eight-pod with a 100.x.y.z address
```

### 20.3 Enable Tailscale Serve and HTTPS in the admin console

Two clicks in the Tailscale admin console (free, both required so we can reach the pod at a clean `https://eight-pod.<tailnet>.ts.net` URL with no port number and a real Let's Encrypt cert):

1. **Enable HTTPS / MagicDNS certs**: <https://login.tailscale.com/admin/dns> then "HTTPS Certificates", **Enable HTTPS**.
2. **Enable Serve**: visit `https://login.tailscale.com/f/serve` (or follow the link tailscaled prints when you run the next command).

Then on the pod:
```bash
tailscale serve --bg --https=443 http://127.0.0.1:3000
tailscale serve status   # expect: https://eight-pod.<tailnet>.ts.net | -- / proxy http://127.0.0.1:3000
```

The first browser hit triggers a Let's Encrypt cert via DNS-01. If the very first request fails with an ACME error, retry once; the ACME account registration takes a few seconds to propagate and the second attempt succeeds.

Get your full FQDN (you'll need it in step 20.4):
```bash
tailscale status --json | grep DNSName
# e.g. eight-pod.tail8d5df2.ts.net
```

### 20.4 Tell Nightstand to accept the Tailscale origin (CORS)

Nightstand's CORS allowlist defaults to LAN origins (`http://192.168.*`, etc.) and rejects requests from your tailnet hostname, which renders the UI as a blank page (HTML loads, every API call 500s). Add the Tailscale FQDN as `ALLOWED_ORIGIN`:

```bash
# Replace with the FQDN from step 20.3
TS_HOST="eight-pod.tail8d5df2.ts.net"
sed -i "/^Environment=NODE_ENV=production/a Environment=ALLOWED_ORIGIN=https://${TS_HOST}" /etc/systemd/system/free-sleep.service
systemctl daemon-reload
systemctl restart free-sleep
```

### 20.5 Re-apply the firewall

The repo's `block_internet_access.sh` already includes the rules Tailscale needs, so you can re-block:

```bash
sh /home/dac/free-sleep/scripts/block_internet_access.sh
```

Tailscale-related rules added (visible via `iptables -L OUTPUT -n -v`):
- `tailscale0` interface in/out (the actual VPN payload to your phone)
- Outbound UDP everywhere (WireGuard direct peer connections and STUN)
- Outbound TCP/443 (Tailscale control plane and DERP relays)
- Outbound DNS (UDP+TCP/53)

Note: allowing outbound TCP/443 broadly means Eight Sleep's API endpoints can technically be reached over HTTPS. The OTA-related services were already masked at the systemd level in step 11, and that mask is the actual mechanism that prevents forced firmware updates. The firewall is a second layer.

### 20.6 Use the pod from your phone

1. Install Tailscale ([App Store](https://apps.apple.com/us/app/tailscale/id1470499037) / [Play Store](https://play.google.com/store/apps/details?id=com.tailscale.ipn)), and sign in to the same account.
2. Open `https://eight-pod.<tailnet>.ts.net` in the phone browser.
3. Tap the share icon, then **Add to Home Screen**, so the Nightstand web app installs as a PWA icon (chromeless, app-like).
4. Leave Tailscale on always. WireGuard's overhead is negligible, and because the pod was added with `--accept-routes=false`, only traffic to `*.ts.net` hostnames goes over the VPN; your normal phone internet stays on cellular/Wi-Fi unaffected. iOS Tailscale also has "VPN On Demand" rules in Settings if you'd rather have it auto-enable per domain.

### 20.7 Verify

From a device not on your home Wi-Fi (turn off the phone's Wi-Fi to force cellular):
- `https://eight-pod.<tailnet>.ts.net` should load the Nightstand web app with live data streaming over the WebSocket.
- From the pod (`ssh -p 8822 root@<POD_IP>`): `tailscale status` should list both the pod and your phone with a `direct` (best, UDP hole-punched) or `derp` (relayed) connection.

Reboot test (proves persistence):
```bash
ssh -p 8822 root@<POD_IP> reboot
# wait ~60s, then re-test from your phone. UI should load without re-auth.
```

---

## Nightstand shortcuts

Run these in a terminal over an SSH session on your pod.

- `fs-debug`: prints a debug report for the pod and Nightstand.
- `fs-restart`: restarts the free-sleep and free-sleep-stream services.
- `fs-reset-db`: deletes the biometrics database and recreates it (useful for a corrupted database file).
- `fs-reset`: deletes all Nightstand data (schedules, biometrics, settings) and reinstalls the latest published build. Useful for a corrupted database, or when switching from the beta channel to stable. Asks for confirmation before running.
- `fs-update`: downloads and installs the newest release of this fork from GitHub, with automatic backup and rollback (the same script the app's Update button runs).
- `fs-dev-server`: stops the Nightstand service and runs the Express server directly with nodemon (for development).
