import { promisify } from 'node:util';

type Completion<Result> = (error: unknown, value?: Result) => void;

export function toPromise<Result>(start: (complete: Completion<Result>) => void): Promise<Result | undefined> {
  return promisify(start)();
}

export type CancelableWait = Promise<void> & { cancel: () => void };

// Cancellation ends the pause successfully so callers can continue cleanup.
export function wait(milliseconds: number): CancelableWait {
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const timeout = setTimeout(finish, milliseconds);
  return Object.assign(pending, {
    cancel() {
      clearTimeout(timeout);
      finish();
    },
  });
}
