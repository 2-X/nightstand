import { AsyncLocalStorage } from 'node:async_hooks';
// Reads and writes share a queue so an older read cannot replace a saved draft.
export function createSerializedUpdate(db) {
    let queue = Promise.resolve();
    const callback = new AsyncLocalStorage();
    const read = db.read.bind(db);
    db.read = () => {
        if (callback.getStore())
            throw new Error('Cannot read this database inside its serialized update callback');
        const result = queue.then(read);
        queue = result.catch(() => undefined);
        return result;
    };
    return (mutate, afterWrite) => {
        const result = queue.then(() => callback.run(true, async () => {
            const draft = structuredClone(await db.adapter.read() ?? db.data);
            if (mutate(draft) !== false) {
                await db.adapter.write(draft);
                db.data = draft;
                await afterWrite?.(draft);
            }
            return draft;
        }));
        // A failed mutation must not prevent later saves.
        queue = result.catch(() => undefined);
        return result;
    };
}
//# sourceMappingURL=serializedUpdate.js.map