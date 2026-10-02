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

export const DEMO_PRESENCE_KEY = 'nightstand-demo-presence';

// The demo has nobody in bed. Specs can seat the left side: 'fresh' for twelve minutes, 'fresh-short' for just now.
export function demoPresence(): 'fresh' | 'fresh-short' | undefined {
  try {
    const value = globalThis.localStorage?.getItem(DEMO_PRESENCE_KEY);
    return value === 'fresh' || value === 'fresh-short' ? value : undefined;
  } catch {
    return undefined;
  }
}

const readDemoKey = (key: string): string | undefined => {
  try {
    return globalThis.localStorage?.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
};

export const DEMO_WRITES_KEY = 'nightstand-demo-writes';

// The Bed specs hold a temperature change unanswered, to draw a target the Pod has not confirmed.
export function demoWritesHang(): boolean {
  return readDemoKey(DEMO_WRITES_KEY) === 'hang';
}
