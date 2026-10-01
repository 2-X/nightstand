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
