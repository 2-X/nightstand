import { runPrivilegedCommand, StartHooks } from './privilegedCommand.js';

export function triggerRollbackService(hooks: StartHooks = {}) {
  return runPrivilegedCommand(['/bin/systemctl', 'start', 'free-sleep-rollback.service', '--no-block'], 'free-sleep-rollback.service', hooks);
}
