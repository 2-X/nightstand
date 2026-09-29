import { runPrivilegedCommand, StartHooks } from './privilegedCommand.js';

export function triggerUpdateService(hooks: StartHooks = {}) {
  return runPrivilegedCommand(['/bin/systemctl', 'start', 'free-sleep-update.service', '--no-block'], 'free-sleep-update.service', hooks);
}

export default function update() {
  return triggerUpdateService();
}
