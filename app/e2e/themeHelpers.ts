/// <reference lib="dom" />
import { expect, type Page } from '@playwright/test';
import { DEFAULT_THEME_ID, THEME_STORAGE_KEY, type ThemeId } from '../src/design/themes/ids';

export const PHONE = { width: 390, height: 844 };
export const DESKTOP = { width: 1280, height: 800 };
export const NARROW = { width: 320, height: 740 };
// Monday noon in the demo's time zone (Los Angeles), the clock the README shots use.
const MONDAY_NOON = new Date('2026-09-28T19:00:00Z');

type Screen = { name: string; path: string; ready: (page: Page) => Promise<void> };
export const SCREENS: Screen[] = [
  { name: 'bed', path: '/', ready: page => expect(page.getByRole('button', { name: /^Turn (off|on)$/ })).toBeVisible() },
  { name: 'schedule', path: '/schedules', ready: page => expect(page.getByRole('heading', { name: 'Coming up', exact: true })).toBeVisible() },
  { name: 'sleep', path: '/sleep', ready: page => expect(page.getByText(/Woke Mon, Sep 28/).first()).toBeVisible() },
  { name: 'settings', path: '/settings', ready: page => expect(page.getByRole('link', { name: /^Bed and sides/ })).toBeVisible() },
];

// A null theme leaves storage alone, as on a device that never chose one.
export async function openThemed(page: Page, theme: ThemeId | null, path: string, viewport: { width: number; height: number }) {
  await page.setViewportSize(viewport);
  if (theme) await page.addInitScript(([key, value]) => localStorage.setItem(key, value), [THEME_STORAGE_KEY, theme] as const);
  await page.clock.setFixedTime(MONDAY_NOON);
  await page.goto(path);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme ?? DEFAULT_THEME_ID);
}

// Every visible control under 44 px either way. A link inside a sentence is text and is left out,
// as are visually hidden elements of 1 px or less.
export const smallTargets = (page: Page) => page.evaluate(() => Array.from(document.querySelectorAll([
  'button', 'a[href]', '[role="tab"]', '[role="switch"]', 'input[type="radio"]', 'input[type="checkbox"]',
].join(', ')))
  .filter(node => !node.closest('p'))
  .map(node => ({ node, rect: node.getBoundingClientRect() }))
  .filter(({ rect }) => rect.width > 1 && rect.height > 1 && (rect.width < 44 || rect.height < 44))
  .map(({ node, rect }) => {
    const name = node.getAttribute('aria-label') ?? node.textContent?.trim();
    return `${name} ${Math.round(rect.width)}x${Math.round(rect.height)}`;
  }));

export const overflows = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
