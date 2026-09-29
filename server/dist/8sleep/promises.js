import { promisify } from 'node:util';
export function toPromise(start) {
    return promisify(start)();
}
// Cancellation ends the pause successfully so callers can continue cleanup.
export function wait(milliseconds) {
    let finish;
    const pending = new Promise(resolve => { finish = resolve; });
    const timeout = setTimeout(finish, milliseconds);
    return Object.assign(pending, {
        cancel() {
            clearTimeout(timeout);
            finish();
        },
    });
}
//# sourceMappingURL=promises.js.map