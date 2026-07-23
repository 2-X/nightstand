import { test, expect } from '@playwright/test';

// Same Add-icon path used in temperature.spec.ts.
const ADD = 'button:has(path[d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6z"])';

// TemperatureLabel.tsx topTitle derivation: while the slider is at rest
// (sliderTemp === currentTargetTemp), it compares currentTemperatureF vs
// currentTargetTemp -> "Warming to" / "Cooling to". Once the user nudges the
// target (sliderTemp !== currentTargetTemp), it compares the new sliderTemp
// vs currentTemperatureF instead -> "Cool to" / "Warm to". Demo left side:
// current 82F, target 84F, so on load 82 < 84 -> "Warming to".

test('topTitle reflects the target-vs-current derivation on load and after a nudge', async ({ page }) => {
  await page.goto('/');

  const topTitle = page.getByRole('heading', { level: 2 }).first().locator('xpath=preceding-sibling::p[1]');
  await expect(topTitle).toHaveText('Warming to');

  await page.locator(ADD).first().click();

  // After nudging the target above the current temperature, the label
  // switches to the actively-adjusting branch.
  await expect(topTitle).toHaveText('Warm to');
});
