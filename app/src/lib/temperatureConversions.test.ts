import { expect, it } from 'vitest';
import { fahrenheitToLevel, levelToFahrenheit, formatTemperature } from './temperatureConversions';
it('round trips each supported level through the stored Fahrenheit value', () => {
  for (let level = -10; level <= 10; level++) {
    expect(fahrenheitToLevel(levelToFahrenheit(level))).toBe(level);
  }
  expect(formatTemperature(83, 'level')).toBe('0');
});
