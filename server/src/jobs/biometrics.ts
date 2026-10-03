import { execFile } from 'child_process';
import { runPrivilegedCommand } from './privilegedCommand.js';

// Pulled out so the "when do we stop the stream" decision is unit-testable
// without spawning a real process. `deepPartial()`-parsed POST /services
// bodies only carry `biometrics.enabled` when the caller is actually
// changing it, so an explicit `=== false` (not just falsy/absent) is the
// signal that the toggle was flipped off.
export function shouldDisableBiometrics(body: { biometrics?: { enabled?: boolean } }): boolean {
  return body.biometrics?.enabled === false;
}

export function shouldEnableBiometrics(body: { biometrics?: { enabled?: boolean } }): boolean {
  return body.biometrics?.enabled === true;
}

// Every on and off request runs after the one before it, with its save, so
// quick toggles end in the state of the last request and the saved switch
// always matches the stream. Requests are not merged: disable_biometrics.sh
// and enable --now are both safe to repeat.
let last: Promise<unknown> = Promise.resolve();
function inOrder<T>(command: () => Promise<void>, save?: () => Promise<T>): Promise<T | undefined> {
  const run = last.then(async () => {
    await command();
    return save?.();
  });
  last = run.catch(() => {});
  return run;
}

// True only when systemd says the stream unit does not exist. Any doubt
// leaves the decision to the privileged command's own checks.
function streamUnitMissing() {
  return new Promise<boolean>((resolve) => {
    execFile('/bin/systemctl', ['show', 'free-sleep-stream.service', '--property=LoadState', '--value'],
      { encoding: 'utf8', timeout: 30_000 }, (error, stdout) => resolve(!error && stdout.trim() === 'not-found'));
  });
}

// Stop and disable the stream only after verifying the installed unit and
// grant, then run save. Without a stream unit there is nothing to stop, so
// the switch can still be turned off.
export function triggerBiometricsDisable<T>(save?: () => Promise<T>) {
  return inOrder(async () => {
    if (await streamUnitMissing()) return;
    await runPrivilegedCommand([
      '/bin/sh', '/home/dac/free-sleep/scripts/disable_biometrics.sh',
    ], 'free-sleep-stream.service', {
      // systemd may take 90 seconds to stop the streamer.
      timeout: 120_000,
      action: 'stop and disable',
    });
  }, save);
}

// The one command the sudo rule allows. It never runs enable_biometrics.sh,
// which installs packages with the firewall open and posts back to this route.
export function triggerBiometricsEnable<T>(save?: () => Promise<T>) {
  return inOrder(
    () => runPrivilegedCommand(['/bin/systemctl', 'enable', '--now', 'free-sleep-stream.service'], 'free-sleep-stream.service'),
    save,
  );
}
