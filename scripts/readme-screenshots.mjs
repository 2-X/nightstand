// Regenerates the README screenshots and docs/hero.png from the demo build.
// Run from the repo root: `node scripts/readme-screenshots.mjs` (Playwright is
// resolved from app/node_modules). Needs a demo dev server: see the hint below.
// Env: BASE_URL (default http://localhost:5182), OUT (default docs/).
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = createRequire(join(root, 'app', 'package.json'))('@playwright/test');

const BASE_URL = process.env.BASE_URL || 'http://localhost:5182';
const OUT = resolve(process.env.OUT || join(root, 'docs'));
const MONDAY_NOON = new Date('2026-09-28T19:00:00Z');
// The demo's sleep records start at the clock's time of day, so a late-evening
// clock (Mon 11:30 PM Pacific) makes the recorded night read as a real night.
const MONDAY_LATE = new Date('2026-09-29T06:30:00Z');
const VIEWPORT = { width: 390, height: 844 };

try {
  await fetch(BASE_URL, { signal: AbortSignal.timeout(5000) });
} catch {
  console.error(`Demo server not reachable at ${BASE_URL}. Start it with:\n  cd app && VITE_ENV=demo VITE_USE_MSW=true npx vite --port 5182`);
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const written = [];

async function shoot(name, time, setup) {
  const context = await browser.newContext({
    viewport: VIEWPORT, deviceScaleFactor: 2, reducedMotion: 'reduce', colorScheme: 'light',
    hasTouch: true, isMobile: true, baseURL: BASE_URL,
  });
  const page = await context.newPage();
  await page.clock.install({ time });
  await setup(page);
  await settle(page);
  const file = join(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  written.push(file);
  await context.close();
}

async function settle(page) {
  await page.addStyleTag({ content: '[aria-label="Saving changes"] { display: none !important; } *, *::before, *::after { caret-color: transparent !important; }' });
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1200);
}

const scrollTo = (page, y) => page.evaluate(top => window.scrollTo(0, top), y);
const goto = (page, path) => page.goto(path, { waitUntil: 'networkidle' });

await shoot('on', MONDAY_NOON, async page => {
  await goto(page, '/');
  await page.getByRole('button', { name: /^Turn off$/ }).waitFor();
});

await shoot('off', MONDAY_NOON, async page => {
  await goto(page, '/');
  await page.getByRole('button', { name: /^Turn off$/ }).click();
  await page.getByRole('button', { name: /^Turn on$/ }).waitFor();
});

await shoot('elevation', MONDAY_NOON, async page => { await goto(page, '/elevation'); });

await shoot('schedules', MONDAY_NOON, async page => {
  await goto(page, '/schedules');
  await page.getByRole('heading', { name: 'Coming up', exact: true }).waitFor();
});

await shoot('rhythm-editor', MONDAY_NOON, async page => {
  await goto(page, '/schedules');
  await page.getByRole('button', { name: 'Edit Workday' }).click();
  await page.getByRole('figure', { name: /^Smart Schedule preview/ }).waitFor();
  await scrollTo(page, 652);
});

await shoot('sleep', MONDAY_LATE, async page => {
  await goto(page, '/sleep');
  await page.getByText('Woke Mon, Sep 28').first().waitFor();
});

await shoot('status', MONDAY_NOON, async page => {
  await goto(page, '/settings/system');
  await page.getByRole('button', { name: /^Core services/ }).click();
});

await shoot('settings', MONDAY_NOON, async page => { await goto(page, '/settings'); });

// Hero: three of the shots as phones on a transparent canvas, so it sits on
// GitHub's light and dark themes alike. Border and shadow are neutral, which
// keeps the black screens visible on a dark page and lifted on a white one.
{
  const HERO = { width: 1600, pad: 64, gap: 56 };
  const phoneW = (HERO.width - 2 * HERO.pad - 2 * HERO.gap) / 3;
  const phoneH = Math.round(phoneW * (2 * VIEWPORT.height) / (2 * VIEWPORT.width));
  const height = phoneH + 2 * HERO.pad;
  const radius = Math.round(phoneW * 44 / (2 * VIEWPORT.width));
  const url = name => `data:image/png;base64,${readFileSync(join(OUT, `${name}.png`)).toString('base64')}`;
  const phones = ['on', 'schedules', 'sleep'].map(name => `<img src="${url(name)}" alt="">`).join('');
  const context = await browser.newContext({ viewport: { width: HERO.width, height }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.setContent(`<!doctype html><meta charset="utf-8"><style>
    html, body { margin: 0; background: transparent; }
    body { width: ${HERO.width}px; height: ${height}px; box-sizing: border-box; padding: ${HERO.pad}px;
      display: flex; gap: ${HERO.gap}px; }
    img { width: ${phoneW}px; height: ${phoneH}px; border-radius: ${radius}px; display: block;
      box-shadow: 0 0 0 1px rgba(128, 128, 128, .5), 0 22px 44px rgba(0, 0, 0, .3), 0 4px 10px rgba(0, 0, 0, .18); }
  </style>${phones}`);
  await page.evaluate(() => Promise.all([...document.images].map(img => img.decode())));
  const file = join(OUT, 'hero.png');
  await page.screenshot({ path: file, omitBackground: true });
  written.push(file);
  await context.close();
}

await browser.close();

// Compress when a tool is installed; skip silently otherwise.
const has = cmd => { try { execFileSync('sh', ['-c', `command -v ${cmd}`], { stdio: 'ignore' }); return true; } catch { return false; } };
for (const f of written) {
  try {
    if (has('oxipng')) execFileSync('oxipng', ['-o', '4', '--strip', 'safe', '-q', f]);
    else if (has('pngquant')) execFileSync('pngquant', ['--force', '--skip-if-larger', '--quality=80-98', '--output', f, f]);
  } catch { /* leave the uncompressed file */ }
}
for (const f of written) console.log(`${(statSync(f).size / 1024).toFixed(0).padStart(5)} KB  ${f}`);
