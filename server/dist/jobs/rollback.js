import { runPrivilegedCommand } from './privilegedCommand.js';
export function triggerRollbackService() {
    return runPrivilegedCommand(['/bin/systemctl', 'start', 'free-sleep-rollback.service', '--no-block'], 'free-sleep-rollback.service');
}
//# sourceMappingURL=rollback.js.map