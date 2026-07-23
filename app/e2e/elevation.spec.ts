import { test, expect } from '@playwright/test';

// Preset target values (client + mock, see BaseControlPage.tsx / mockData.ts):
// Flat {0,0}, Sleep {1,5}, Relax {30,15}, Read {40,0}.

test('clicking the Relax preset settles head/feet to its target position', async ({ page }) => {
  await page.goto('/elevation');

  // HEAD/FEET numbers are plain unlabeled Typography; find the value paragraph
  // that immediately follows the "HEAD"/"FEET" label paragraph.
  const headValue = page.locator('p:text-is("HEAD")').locator('xpath=following-sibling::div[1]//p');
  const feetValue = page.locator('p:text-is("FEET")').locator('xpath=following-sibling::div[1]//p');
  await expect(headValue).toHaveText('0');
  await expect(feetValue).toHaveText('0');

  // Locate the button by its icon's stable aria-label ("Relax"), not its text
  // label, which flips to "Stop"/"Moving..." once the move starts.
  const relaxButton = page.getByRole('button').filter({ has: page.getByRole('img', { name: 'Relax' }) });
  await relaxButton.click();

  // Clicking does not optimistically update; the mock simulates a move
  // (isMoving true immediately, target applied after a delay).
  await expect(relaxButton).toContainText('Stop');
  await expect(relaxButton).toContainText('Moving...');

  // Once the move settles, HEAD/FEET should match the Relax preset target.
  await expect(headValue).toHaveText('30', { timeout: 15_000 });
  await expect(feetValue).toHaveText('15', { timeout: 15_000 });
});
