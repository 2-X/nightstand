export const DEMO_RHYTHMS_KEY = 'nightstand-demo-rhythms';

// The hosted demo shows Rhythms. Unit tests, and specs that cover the weekly schedule, start with it off.
export function demoRhythmsDefault(): boolean {
  if (import.meta.env.MODE === 'test') return false;
  try {
    return globalThis.localStorage?.getItem(DEMO_RHYTHMS_KEY) !== 'off';
  } catch {
    return true;
  }
}

export const DEMO_UPDATE_KEY = 'nightstand-demo-update';

// The demo reports itself up to date. The update dialog spec turns on a sample newer release.
export function demoOffersUpdate(): boolean {
  try {
    return globalThis.localStorage?.getItem(DEMO_UPDATE_KEY) === 'on';
  } catch {
    return false;
  }
}
