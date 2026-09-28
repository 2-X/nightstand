import { test, expect } from '@playwright/test';

test('loads fonts and styles without contacting third-party hosts', async ({ page, baseURL }) => {
  const external: string[] = [];
  page.on('request', request => {
    if (['font', 'stylesheet'].includes(request.resourceType()) && new URL(request.url()).origin !== new URL(baseURL!).origin) {
      external.push(request.url());
    }
  });
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'Primary mobile' })).toBeVisible();
  expect(external).toEqual([]);
});
