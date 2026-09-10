import { AsyncLocalStorage } from 'node:async_hooks';
export const thermalWriteContext = new AsyncLocalStorage();
/** One queue for complete temperature/power transactions, including raw API writes. */
export class ThermalQueue {
    tail = Promise.resolve();
    run(action) {
        const result = this.tail.then(action);
        this.tail = result.catch(() => undefined);
        return result;
    }
}
export const thermalQueue = new ThermalQueue();
export function assertThermalWriteAllowed() {
    const context = thermalWriteContext.getStore();
    if (context?.source === 'automatic' && !context.allowed?.())
        throw new Error('Automatic change cancelled by newer intent or health state');
}
//# sourceMappingURL=thermalQueue.js.map