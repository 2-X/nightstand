export class FrankenSupersededError extends Error {
  public constructor() {
    super('A newer command for the same setting replaced this one');
    this.name = 'FrankenSupersededError';
  }
}
