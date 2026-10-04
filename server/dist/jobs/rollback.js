import { runPrivilegedCommand } from './privilegedCommand.js';
export function triggerRollbackService(hooks = {}) {
    return runPrivilegedCommand(['/bin/systemctl', 'start', 'free-sleep-rollback.service', '--no-block'], 'free-sleep-rollback.service', hooks);
}
//# sourceMappingURL=rollback.js.map