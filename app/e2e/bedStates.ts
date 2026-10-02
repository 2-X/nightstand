/// <reference lib="dom" />
import { expect, type BrowserContext, type Page } from '@playwright/test';

export const BED_STATES = [
  'on', 'off', 'cooling', 'limit', 'zero', 'getup', 'upstale', 'paused', 'away', 'unit', 'pending', 'stale', 'loading',
] as const;
// An indexed access type is the one way to derive the union from the list, which the alias rule does not allow.
// eslint-disable-next-line @typescript-eslint/no-type-alias
export type BedState = typeof BED_STATES[number];

// Monday 9:41 PM in the demo's time zone (Los Angeles), before Monday's Workday sleep starts.
const EVENING = new Date('2026-09-29T04:41:00Z');
// Monday 11:00 PM, inside that sleep, so its turn-off is tomorrow morning.
const IN_SLEEP = new Date('2026-09-29T06:00:00Z');

// The demo's presence switch, read by demoPresence and demoPresenceStale in src/mocks/demoPreferences.ts: 'fresh' seats
// the left side for twelve minutes, 'fresh-short' just now, and 'stale' leaves it seated at a report too old to trust.
const DEMO_PRESENCE_KEY = 'nightstand-demo-presence';
type DemoPresence = 'fresh' | 'fresh-short' | 'stale';
// Now, for the next request, or before the page loads.
export async function setDemoPresence(page: Page, value: DemoPresence) {
  await page.evaluate(([key, entry]) => localStorage.setItem(key, entry), [DEMO_PRESENCE_KEY, value] as const);
}
export async function presetDemoPresence(page: Page, value: DemoPresence) {
  await page.addInitScript(([key, entry]) => localStorage.setItem(key, entry), [DEMO_PRESENCE_KEY, value] as const);
}

const PREFS: Partial<Record<BedState, Record<string, string>>> = {
  upstale: { [DEMO_PRESENCE_KEY]: 'stale' },
  pending: { 'nightstand-demo-writes': 'hang' },
  loading: { 'nightstand-demo-reads': 'hang' },
};

export const viewportFor = (width: number) => ({ width, height: width === 320 ? 740 : width === 390 ? 844 : 800 });

const nav = (page: Page) => page.locator('nav[aria-label^="Primary"]:visible');
const lead = (page: Page) => page.locator('[data-dial] p').first();

async function tap(page: Page, name: 'Cooler' | 'Warmer', times: number) {
  await page.getByRole('button', { name }).evaluate((node, count) => {
    for (let i = 0; i < count; i++) (node as HTMLElement).click();
  }, times);
}

// Saves settings in the demo, then visits Schedule and comes back so Bed reads them again.
async function postSettings(page: Page, body: object) {
  await page.evaluate(async payload => {
    await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  }, body);
  await nav(page).getByRole('link', { name: 'Schedule', exact: true }).click();
  await nav(page).getByRole('link', { name: 'Bed', exact: true }).click();
}

export async function openBedState(context: BrowserContext, state: BedState, width: number, { verify = true } = {}): Promise<Page> {
  const page = await context.newPage();
  await page.setViewportSize(viewportFor(width));
  await page.addInitScript(entries => {
    for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, value);
  }, PREFS[state] ?? {});
  const inSleep = state === 'getup' || state === 'upstale';
  await page.clock.install({ time: inSleep ? IN_SLEEP : EVENING });
  const settle = async (check: () => Promise<void>) => {
    if (verify) await check();
    else await page.waitForTimeout(2500);
  };

  if (inSleep) {
    await page.goto('/schedules');
    await page.getByRole('button', { name: 'Edit Workday' }).click();
    await page.getByRole('combobox', { name: /^Turn off/ }).click();
    await page.getByRole('option', { name: 'When I get up' }).click();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await nav(page).getByRole('link', { name: 'Bed', exact: true }).click();
  } else {
    await page.goto('/');
  }
  if (state === 'loading') {
    await settle(() => expect(page.locator('[data-dial]').getByRole('status')).toHaveText('Loading'));
    return page;
  }
  await expect(page.getByRole('button', { name: 'Turn off' })).toBeVisible();

  switch (state) {
  case 'off':
    await page.getByRole('button', { name: 'Turn off' }).click();
    await expect(page.getByRole('button', { name: 'Turn on' })).toBeVisible();
    break;
  case 'cooling':
    await tap(page, 'Cooler', 2);
    await settle(() => expect(lead(page)).toHaveText('Cooling to'));
    break;
  case 'limit':
    await tap(page, 'Warmer', 9);
    await settle(async () => {
      await expect(page.locator('[data-dial] h2')).toHaveText('+10');
      await expect(lead(page)).toHaveText('Warming to');
    });
    break;
  case 'zero':
    await tap(page, 'Cooler', 1);
    await settle(async () => {
      await expect(page.locator('[data-dial] h2')).toHaveText('0');
      await expect(lead(page)).not.toHaveText('Set to');
    });
    break;
  case 'getup':
    await settle(() => expect(page.locator('[data-caption-slot]')).toHaveText(/^Turns off when you get up, tomorrow by\s9:45\sAM$/));
    break;
  case 'upstale':
    await settle(() => expect(page.locator('[data-caption-slot]')).toHaveText(/^Turns off tomorrow by\s9:45\sAM$/));
    break;
  case 'paused':
    await page.getByRole('button', { name: 'Pause schedule' }).click();
    await page.getByRole('radio', { name: /^Until I resume/ }).check();
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await settle(() => expect(page.getByRole('radio', { name: /^Alex\. Paused, \+1\./ })).toBeAttached());
    break;
  case 'away':
    await postSettings(page, { left: { awayMode: true } });
    await settle(() => expect(page.locator('[data-power-row]')).toContainText('Away mode is on.'));
    break;
  case 'unit':
    await postSettings(page, { temperatureFormat: 'fahrenheit' });
    await settle(() => expect(page.locator('[data-dial] h2')).toHaveText('84°F'));
    break;
  case 'pending':
    await tap(page, 'Warmer', 1);
    await settle(() => expect(lead(page)).toHaveText('Set to'));
    break;
  case 'stale':
    // A refresh still in flight would answer after the jump and make the status fresh again.
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => localStorage.setItem('nightstand-demo-reads', 'fail'));
    await page.clock.fastForward('02:05');
    await settle(() => expect(page.getByRole('heading', { level: 1, name: 'Bed' }).locator('xpath=..').getByRole('status'))
      .toHaveText('Not responding'));
    break;
  default:
    break;
  }
  return page;
}
