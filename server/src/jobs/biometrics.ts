import { spawn } from 'child_process';
import logger from '../logger.js';

// Pulled out so the "when do we stop the stream" decision is unit-testable
// without spawning a real process. `deepPartial()`-parsed POST /services
// bodies only carry `biometrics.enabled` when the caller is actually
// changing it, so an explicit `=== false` (not just falsy/absent) is the
// signal that the toggle was flipped off.
export function shouldDisableBiometrics(body: { biometrics?: { enabled?: boolean } }): boolean {
  return body.biometrics?.enabled === false;
}

// Mirrors triggerUpdateService/triggerRollbackService (server/src/jobs/update.ts,
// rollback.ts): fire-and-forget via a NOPASSWD sudoers rule, detached so the
// request handler doesn't wait on it. Flipping the Settings biometrics toggle
// off previously only wrote `biometrics.enabled: false` to the DB: it never
// stopped free-sleep-stream.service, leaving it running indefinitely. This
// actually stops+disables the systemd unit via the (previously dead)
// scripts/disable_biometrics.sh.
export function triggerBiometricsDisable() {
  logger.debug('Running disable_biometrics.sh...');
  const child = spawn('sudo', ['/bin/sh', '/home/dac/free-sleep/scripts/disable_biometrics.sh'], {
    stdio: 'ignore',
    detached: true,
  });
  child.unref();
}
