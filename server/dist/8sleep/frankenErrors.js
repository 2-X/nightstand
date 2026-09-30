export class FrankenSupersededError extends Error {
    constructor() {
        super('A newer command for the same setting replaced this one');
        this.name = 'FrankenSupersededError';
    }
}
//# sourceMappingURL=frankenErrors.js.map