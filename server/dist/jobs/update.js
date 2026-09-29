import { runPrivilegedCommand } from './privilegedCommand.js';
export function triggerUpdateService(hooks = {}) {
    return runPrivilegedCommand(['/bin/systemctl', 'start', 'free-sleep-update.service', '--no-block'], 'free-sleep-update.service', hooks);
}
export default function update() {
    return triggerUpdateService();
}
//# sourceMappingURL=update.js.map