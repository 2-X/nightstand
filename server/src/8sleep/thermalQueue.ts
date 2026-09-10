import { AsyncLocalStorage } from 'node:async_hooks';
import type { ThermalOrigin } from './adaptiveState.js';

interface WriteContext { source: ThermalOrigin; allowed?: () => boolean }
export const thermalWriteContext = new AsyncLocalStorage<WriteContext>();
/** One queue for complete temperature/power transactions, including raw API writes. */
export class ThermalQueue {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(action: () => Promise<T>): Promise<T> {
    const result = this.tail.then(action);
    this.tail = result.catch(() => undefined);
    return result;
  }
}
export const thermalQueue = new ThermalQueue();
export function assertThermalWriteAllowed(): void {
  const context = thermalWriteContext.getStore();
  if (context?.source === 'automatic' && !context.allowed?.()) throw new Error('Automatic change cancelled by newer intent or health state');
}
