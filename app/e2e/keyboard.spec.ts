import { test, expect } from '@playwright/test';

test('a feature switch keeps keyboard focus after it saves', async ({ page }) => {
  await page.goto('/settings/features');
  const toggle = page.getByRole('switch', { name: 'One-time alarm', exact: true });
  await expect(toggle).toBeVisible();
  await toggle.focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Space');
  await expect(toggle).not.toBeChecked();
  await expect(toggle).toBeFocused();
});

test('the time zone picker keeps keyboard focus after a choice saves', async ({ page }) => {
  await page.goto('/settings/bed');
  const picker = page.getByRole('combobox', { name: 'Time zone' });
  await expect(picker).toBeVisible();
  await picker.focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Enter');
  await page.getByRole('listbox').waitFor();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await expect(picker).toBeFocused();
});

test('Turn off keeps keyboard focus after it saves', async ({ page }) => {
  await page.goto('/');
  const power = page.getByRole('button', { name: /^Turn o(ff|n)$/ });
  await power.focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  const before = await power.textContent();
  await page.keyboard.press('Enter');
  await expect(power).not.toHaveText(before ?? '');
  await expect(power).toBeFocused();
});

test('focused controls scroll clear of the bottom navigation', async ({ page }) => {
  await page.goto('/settings/bed');
  await expect(page.getByRole('button', { name: 'Level' })).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Primary mobile' });
  const navTop = (await nav.boundingBox())!.y;
  for (let step = 0; step < 40; step += 1) {
    await page.keyboard.press('Tab');
    const box = await page.evaluate(() => {
      const active = document.activeElement;
      if (!active || active === document.body || active.closest('nav')) return null;
      const rect = active.getBoundingClientRect();
      return { bottom: rect.bottom, top: rect.top };
    });
    if (box) expect(box.bottom).toBeLessThanOrEqual(navTop);
  }
});

test('a skip link comes first, then the navigation, before the page content', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to main content' });
  await expect(skip).toBeFocused();
  expect((await skip.boundingBox())!.y).toBeGreaterThanOrEqual(0);
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => !!document.activeElement?.closest('nav'))).toBe(true);
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => !!document.activeElement?.closest('main'))).toBe(true);
});

test('keyboard focus shows an outline on buttons', async ({ page }) => {
  await page.goto('/');
  const power = page.getByRole('button', { name: /^Turn o(ff|n)$/ });
  await power.focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(power).toHaveCSS('outline-style', 'solid');
  await expect(power).toHaveCSS('outline-width', '2px');
});
