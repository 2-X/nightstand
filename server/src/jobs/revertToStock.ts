import { runPrivilegedCommand, StartHooks } from './privilegedCommand.js';

export function triggerRevertToStockService(hooks: StartHooks = {}) {
  return runPrivilegedCommand(['/bin/systemctl', 'start', 'free-sleep-revert.service', '--no-block'], 'free-sleep-revert.service', hooks);
}
