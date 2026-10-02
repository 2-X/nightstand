/// <reference lib="dom" />
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 } });

test('turning a side off keeps the power button in place and shows last night under the dial', async ({ page }) => {
  await page.goto('/');
  const turnOff = page.getByRole('button', { name: 'Turn off' });
  await expect(turnOff).toBeVisible();
  // While on, last night stays in the card below the controls.
  await expect(page.getByRole('button', { name: /^Last night's sleep estimate: \d+/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Increase temperature' })).toBeVisible();
  const onTop = (await turnOff.boundingBox())!.y;

  await turnOff.click();
  const turnOn = page.getByRole('button', { name: 'Turn on' });
  await expect(turnOn).toBeVisible();
  const viewSleep = page.getByRole('link', { name: 'View last night\'s sleep' });
  await expect(viewSleep).toBeVisible();
  await expect(page.getByText(/^Last night's sleep estimate: \d+$/)).toBeVisible();
  await expect(page.getByRole('button', { name: /^Last night's sleep estimate/ })).toHaveCount(0);

  const offTop = (await turnOn.boundingBox())!.y;
  expect(Math.abs(offTop - onTop)).toBeLessThanOrEqual(1);

  // Above the fold: clear of the bottom navigation without scrolling.
  const nav = (await page.getByRole('navigation', { name: 'Primary mobile' }).boundingBox())!;
  const link = (await viewSleep.boundingBox())!;
  expect(link.y + link.height).toBeLessThanOrEqual(nav.y);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

for (const width of [390, 320]) {
  test(`the caption stays put in the dock, clear of the power control, when the side turns off at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 740 });
    await page.goto('/');
    const dock = page.locator('[data-power-dock]');
    const caption = dock.locator('[data-dock-caption]');
    await expect(caption).toContainText(/^Turns off/);
    const textHeight = () => caption.evaluate(node => Array.from(node.children)
      .reduce((sum, child) => sum + child.getBoundingClientRect().height, 0));
    const onBox = (await caption.boundingBox())!;
    const onText = await textHeight();
    const dockBox = (await dock.boundingBox())!;
    // The stepper above ends before the dock starts.
    const stepper = (await page.getByRole('button', { name: 'Decrease temperature' }).boundingBox())!;
    expect(stepper.y + stepper.height).toBeLessThanOrEqual(dockBox.y);

    await page.getByRole('button', { name: 'Turn off' }).click();
    const power = page.getByRole('button', { name: 'Turn on' });
    await expect(power).toBeVisible();
    await expect(caption).toContainText(/^(Starts warming|Turns on)/);
    const offBox = (await caption.boundingBox())!;
    const offText = await textHeight();
    expect(Math.abs(offBox.y - onBox.y)).toBeLessThanOrEqual(1);

    // Inside the dock, clear of the power control, and the text fits its slot.
    const powerBox = (await power.boundingBox())!;
    for (const [box, text] of [[onBox, onText], [offBox, offText]] as const) {
      expect(box.x).toBeGreaterThanOrEqual(dockBox.x);
      expect(box.y).toBeGreaterThanOrEqual(dockBox.y);
      expect(box.y + box.height).toBeLessThanOrEqual(dockBox.y + dockBox.height);
      expect(box.x + box.width).toBeLessThanOrEqual(powerBox.x - 8);
      expect(text).toBeLessThanOrEqual(box.height + 1);
    }
  });
}

for (const [width, height] of [[320, 740], [375, 812], [390, 844]] as const) {
  test(`a long caption and a short one leave the dock and the power button in place at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    // Monday 11:00 PM, inside Monday's Workday sleep, so a get-up caption says tomorrow.
    await page.clock.install({ time: new Date('2026-09-29T06:00:00Z') });
    await page.goto('/schedules');
    await page.getByRole('button', { name: 'Edit Workday' }).click();
    await page.getByRole('combobox', { name: /^Turn off/ }).click();
    await page.getByRole('option', { name: 'When I get up' }).click();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByRole('navigation', { name: 'Primary mobile' }).getByRole('link', { name: 'Bed', exact: true }).click();

    const dock = page.locator('[data-power-dock]');
    const caption = dock.locator('[data-dock-caption]');
    // Page positions, so scrolling to the pause button does not count as movement.
    const measure = () => page.evaluate(() => {
      const top = (selector: string) => document.querySelector(selector)!.getBoundingClientRect().top + window.scrollY;
      const power = Array.from(document.querySelectorAll('[data-power-dock] button'))
        .find(button => /^Turn (on|off)$/.test(button.textContent ?? ''))!;
      return {
        caption: top('[data-dock-caption]'),
        dockTop: top('[data-power-dock]'),
        dockHeight: document.querySelector('[data-power-dock]')!.getBoundingClientRect().height,
        power: power.getBoundingClientRect().top + window.scrollY,
        text: document.querySelector('[data-dock-caption] p')!.getBoundingClientRect().height,
      };
    });

    await expect(caption).toHaveText('Turns off when you get up, tomorrow by 9:45 AM');
    const long = await measure();

    await page.getByRole('button', { name: 'Pause schedule' }).click();
    await page.getByRole('radio', { name: /^Until I resume/ }).check();
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(caption).toHaveText(/^Turns off at\s/);
    const short = await measure();

    expect(short.text).toBeLessThan(long.text);
    for (const key of ['caption', 'dockTop', 'dockHeight', 'power'] as const) {
      expect(Math.abs(short[key] - long[key])).toBeLessThanOrEqual(1);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}

const sizes = [[320, 740], [390, 844], [768, 1024], [1280, 800]] as const;
for (const [width, height] of sizes) {
  test(`the power button never moves while toggling at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/');
    // The tabs appear a moment after the page first paints and move everything below them.
    await expect(page.getByRole('link', { name: 'Elevation' })).toBeVisible();
    const power = page.getByRole('button', { name: /^Turn (on|off)$/ });
    await expect(power).toHaveText('Turn off');
    const rest = (await power.boundingBox())!;

    for (const next of ['Turn on', 'Turn off']) {
      await power.click();
      const boxes: { x: number; y: number; width: number }[] = [];
      for (let i = 0; i < 25; i++) {
        await page.waitForTimeout(80);
        boxes.push((await power.boundingBox())!);
      }
      await expect(power).toHaveText(next);
      for (const box of boxes) {
        expect(Math.abs(box.y - rest.y)).toBeLessThanOrEqual(1);
        expect(Math.abs(box.x - rest.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(box.width - rest.width)).toBeLessThanOrEqual(1);
      }
    }
  });
}

for (const [width, height] of [[390, 844], [1280, 800]] as const) {
  test(`nothing below the header moves while the page loads at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    // Sample every frame from the first one: the side tiles exist from first paint, the power button once
    // the bed status arrives. Keep sampling for 2 s after the button appears.
    await page.addInitScript(() => {
      const samples: { tiles: number[]; power: number[] } = { tiles: [], power: [] };
      (window as unknown as { loadSamples: typeof samples }).loadSamples = samples;
      let powerSeenAt = 0;
      const sample = (now: number) => {
        const tiles = document.querySelector('[role="radiogroup"][aria-label="Bed side"]');
        const power = Array.from(document.querySelectorAll('button')).find(button => /^Turn (on|off)$/.test(button.textContent ?? ''));
        if (tiles) samples.tiles.push(tiles.getBoundingClientRect().top);
        if (power) {
          powerSeenAt ||= now;
          samples.power.push(power.getBoundingClientRect().top);
        }
        if (!powerSeenAt || now - powerSeenAt < 2000) requestAnimationFrame(sample);
        else (window as unknown as { loadDone: boolean }).loadDone = true;
      };
      requestAnimationFrame(sample);
    });
    await page.goto('/');
    await page.waitForFunction(() => (window as unknown as { loadDone?: boolean }).loadDone, undefined, { timeout: 20_000 });
    await expect(page.getByRole('link', { name: 'Elevation' })).toBeVisible();
    const { tiles, power } = await page.evaluate(() => (window as unknown as { loadSamples: { tiles: number[]; power: number[] } }).loadSamples);
    expect(power.length).toBeGreaterThan(10);
    for (const series of [tiles, power]) {
      expect(Math.max(...series) - Math.min(...series)).toBeLessThanOrEqual(1);
    }
  });
}
