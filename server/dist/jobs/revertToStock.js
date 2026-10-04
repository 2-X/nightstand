import { runPrivilegedCommand } from './privilegedCommand.js';
export function triggerRevertToStockService(hooks = {}) {
    return runPrivilegedCommand(['/bin/systemctl', 'start', 'free-sleep-revert.service', '--no-block'], 'free-sleep-revert.service', hooks);
}
//# sourceMappingURL=revertToStock.js.map