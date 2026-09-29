import { runPrivilegedCommand } from './privilegedCommand.js';
export function triggerRevertToStockService() {
    return runPrivilegedCommand(['/bin/systemctl', 'start', 'free-sleep-revert.service', '--no-block'], 'free-sleep-revert.service');
}
//# sourceMappingURL=revertToStock.js.map