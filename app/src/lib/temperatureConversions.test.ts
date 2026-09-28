import { expect, it } from 'vitest';
import { getTemperatureColor, levelToFahrenheit } from './temperatureConversions';
it('shows level zero as neutral', () => {
  expect(getTemperatureColor(levelToFahrenheit(0))).toBe('#9e9e9e');
  expect(getTemperatureColor(levelToFahrenheit(1))).not.toBe('#9e9e9e');
});
