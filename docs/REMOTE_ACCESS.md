# Remote access with Tailscale

By default you can only reach the Nightstand web app from your home Wi-Fi. [Tailscale](https://tailscale.com) is a third-party service, built on WireGuard, that puts your phone and the Pod on a private encrypted network. You can then reach the Pod from anywhere without exposing it to the public internet. Tailscale offers a Personal plan; check its [current pricing and eligibility](https://tailscale.com/pricing) before choosing it.

Nightstand's API has no login. Restrict which tailnet users and devices can
reach the Pod using [Tailscale's access controls](https://tailscale.com/docs/features/access-control/acls). A private tunnel and Origin
filtering do not add a Nightstand login. Do not expose the app with public
port forwarding or Tailscale Funnel.

Commands below run **on the Pod as root over SSH**, except where stated.

In outline: install the Tailscale daemon on the Pod, run `tailscale up` to log in, enable HTTPS and Serve in the admin console, allow the new address in Nightstand, then turn the firewall back on.

## 1 Install the Tailscale daemon on the pod

The Pod needs internet access to download Tailscale. If the firewall is on (you did [installation step 19](../INSTALLATION.md#19-add-firewall-rules-to-block-internet-access-optional-but-recommended), migrated from another fork, or installed an update from the app), turn it off for now:
```bash
sh /home/dac/free-sleep/scripts/unblock_internet_access.sh
```

Then run this on the Pod as root. Before you do, check [pkgs.tailscale.com](https://pkgs.tailscale.com/stable/#static) for the newest arm64 version and change `VERSION` to match. If the checksum doesn't match, the `exit 1` ends your shell session before anything is installed; log back in and download again.
```bash
# Pre-flight: confirm the kernel exposes /dev/net/tun
ls -la /dev/net/tun || modprobe tun

# Pick the latest aarch64 build from https://pkgs.tailscale.com/stable/#static
# Example version; check the current download first.
VERSION=1.96.4
TARBALL=tailscale_${VERSION}_arm64.tgz
cd /tmp
curl -fLO "https://pkgs.tailscale.com/stable/${TARBALL}"
curl -fsSL "https://pkgs.tailscale.com/stable/${TARBALL}.sha256" -o "${TARBALL}.sha256"
[ "$(awk '{print $1}' "${TARBALL}.sha256")" = "$(sha256sum "${TARBALL}" | awk '{print $1}')" ] \
  && echo OK || { echo CHECKSUM_MISMATCH; exit 1; }

# Install binaries on rootfs and daemon state on the persistent partition.
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

## 2 Log the pod in to your tailnet

```bash
tailscale up --hostname=eight-pod --accept-routes=false --advertise-exit-node=false
```

It prints a login URL (`https://login.tailscale.com/a/...`). Open it in any browser, sign in or create a Tailscale account, and approve the device. Then, back on the Pod:

```bash
tailscale status     # should show eight-pod with a 100.x.y.z address
```

## 3 Enable Tailscale Serve and HTTPS in the admin console

See the current [Tailscale Serve documentation](https://tailscale.com/docs/features/tailscale-serve)
if the admin-console labels differ.

Two settings in the Tailscale admin console let you reach the Pod at `https://eight-pod.<tailnet>.ts.net` with no port number and a Let's Encrypt certificate:

1. **Enable HTTPS certificates**: open <https://login.tailscale.com/admin/dns>, find "HTTPS Certificates", and choose **Enable HTTPS**.
2. **Enable Serve**: visit `https://login.tailscale.com/f/serve`, or follow the link the next command prints if Serve isn't on yet.

Then on the Pod:
```bash
tailscale serve --bg --https=443 http://127.0.0.1:3000
tailscale serve status   # expect: https://eight-pod.<tailnet>.ts.net | -- / proxy http://127.0.0.1:3000
```

The first time you open the site, Tailscale requests the certificate. If that first request fails with an ACME error, wait a few seconds and try again.

Get your full hostname for step 4. If more than one line appears, use the one that starts with `eight-pod`. Tailscale may print it with a trailing dot; leave the dot off when you copy it.
```bash
tailscale status --json | grep DNSName
# e.g. eight-pod.<your-tailnet>.ts.net
```

## 4 Tell Nightstand to accept the Tailscale origin (CORS)

Nightstand checks HTTP and WebSocket origins against local addresses and an
optional exact `ALLOWED_ORIGIN`. A Tailscale HTTPS hostname needs that explicit
origin. This permits browser access from the address; it is not authentication.
Add your Tailscale hostname as follows:

```bash
# Replace with the FQDN from step 3
TS_HOST="eight-pod.<your-tailnet>.ts.net"
sed -i "/^Environment=NODE_ENV=production/a Environment=ALLOWED_ORIGIN=https://${TS_HOST}" /etc/systemd/system/free-sleep.service
systemctl daemon-reload
systemctl restart free-sleep
```

In-app updates keep this setting. Rerunning the [installation step 13](../INSTALLATION.md#13-install-the-nightstand-server) installer rewrites the service file, so repeat this step if you ever do that.

## 5 Re-apply the firewall

The block script checks whether Tailscale is running when it applies the rules. Check that `tailscale status` works, then turn the firewall back on:

```bash
sh /home/dac/free-sleep/scripts/block_internet_access.sh
```

It prints `tailscaled active: allowing its control-plane/DERP/STUN egress`. If it says `tailscaled inactive` instead, start Tailscale and run it again.

The Tailscale-related rules (visible with `iptables -L OUTPUT -n -v`) are:
- `tailscale0` interface in/out (the VPN traffic to your phone)
- Outbound UDP to any host (WireGuard direct peer connections and STUN)
- Outbound TCP/443 (Tailscale control plane and DERP relays)
- Outbound DNS (UDP and TCP port 53)

These exceptions remain after Tailscale stops, until the firewall is reapplied
or changed. Rerun the block script after changing Tailscale setup; stopping
Tailscale and reapplying it removes the broad exceptions.

As noted in [installation step 19](../INSTALLATION.md#19-add-firewall-rules-to-block-internet-access-optional-but-recommended), these rules leave the Pod able to reach any HTTPS host. Masking the update services in [installation step 11](../INSTALLATION.md#11-disable-software-updates) is what prevents automatic firmware updates.

## 6 Use the pod from your phone

1. Install Tailscale on your phone ([App Store](https://apps.apple.com/us/app/tailscale/id1470499037) / [Play Store](https://play.google.com/store/apps/details?id=com.tailscale.ipn)) and sign in to the same account.
2. Open `https://eight-pod.<tailnet>.ts.net` in the phone's browser.
3. Add it to your home screen as in [installation step 16](../INSTALLATION.md#16-save-the-nightstand-web-app-to-your-home-screen), so it opens like an app.
4. Leave Tailscale on. Unless you set up an exit node, only traffic to your tailnet goes through it; the rest of your phone's traffic is unaffected. The iOS app also has "VPN On Demand" rules in its settings if you'd rather it connect only for certain domains.

## 7 Verify

From a device that isn't on your home Wi-Fi (on a phone, turn off Wi-Fi to use cellular):
- `https://eight-pod.<tailnet>.ts.net` should load the Nightstand web app with live data.
- On the Pod (`ssh -p 8822 root@<POD_IP>`), `tailscale status` should list both the Pod and your phone. The connection shows as `direct` (peer to peer) or as a relay through Tailscale's servers. Either works.

To check that it survives a restart, run the command below on your computer
while the bed is idle, then test again from your phone. The page should load
without logging in again. Allow a few minutes for the Pod to come back
(see [installation step 17](../INSTALLATION.md#17-validation)).

```bash
ssh -p 8822 root@<POD_IP> reboot
# Allow a few minutes, then test again from your phone.
```
