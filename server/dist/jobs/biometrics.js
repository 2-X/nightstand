import { runPrivilegedCommand } from './privilegedCommand.js';
// Pulled out so the "when do we stop the stream" decision is unit-testable
// without spawning a real process. `deepPartial()`-parsed POST /services
// bodies only carry `biometrics.enabled` when the caller is actually
// changing it, so an explicit `=== false` (not just falsy/absent) is the
// signal that the toggle was flipped off.
export function shouldDisableBiometrics(body) {
    return body.biometrics?.enabled === false;
}
// Stop and disable the stream only after verifying the installed unit and grant.
export function triggerBiometricsDisable() {
    return runPrivilegedCommand(['/bin/sh', '/home/dac/free-sleep/scripts/disable_biometrics.sh'], 'free-sleep-stream.service', {
        // systemd may take 90 seconds to stop the streamer.
        timeout: 120_000,
        action: 'stop and disable',
    });
}
//# sourceMappingURL=biometrics.js.map