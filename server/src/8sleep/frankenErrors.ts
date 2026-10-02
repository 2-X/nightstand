export class FrankenSupersededError extends Error {
  public constructor() {
    super('A newer command for the same setting replaced this one');
    this.name = 'FrankenSupersededError';
  }
}

export class FrankenConnectionClosedError extends Error {
  public constructor(message = 'Franken connection closed') {
    super(message);
    this.name = 'FrankenConnectionClosedError';
  }
}

// Errors from a command whose bytes were fully written to the Pod. Whatever
// happened after that, the Pod may have acted on it.
const written = new WeakSet<object>();

export function markCommandWritten(error: Error): void {
  written.add(error);
}

export function wasCommandWritten(error: unknown): boolean {
  return typeof error === 'object' && error !== null && written.has(error);
}
