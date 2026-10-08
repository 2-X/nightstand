import { expect, it } from 'vitest';
import { displayTemperature, fahrenheitToLevel, levelToFahrenheit, formatTemperature } from './temperatureConversions';
it('round trips each supported level through the stored Fahrenheit value', () => {
  for (let level = -10; level <= 10; level++) {
    expect(fahrenheitToLevel(levelToFahrenheit(level))).toBe(level);
  }
  expect(formatTemperature(83, 'level')).toBe('0');
});

it('pins all canonical legacy Fahrenheit values independently of the firmware readout', () => {
  expect(Array.from({ length: 21 }, (_, index) => levelToFahrenheit(index - 10))).toEqual([
    55, 58, 61, 63, 66, 69, 72, 74, 77, 80, 83, 85, 88, 91, 94, 96, 99, 102, 105, 107, 110,
  ]);
});

it('shows a true minus sign for negative levels on display text', () => {
  expect(displayTemperature(levelToFahrenheit(-3), 'level')).toBe('\u22123');
  expect(displayTemperature(levelToFahrenheit(-10), 'level')).toBe('\u221210');
  expect(displayTemperature(levelToFahrenheit(2), 'level')).toBe('+2');
  expect(displayTemperature(levelToFahrenheit(0), 'level')).toBe('0');
  expect(displayTemperature(82, 'fahrenheit')).toBe('82°F');
  expect(displayTemperature(82, 'celsius')).toBe('28°C');
});

it('shows a true minus sign for negative Fahrenheit and Celsius too', () => {
  expect(displayTemperature(-4, 'fahrenheit')).toBe('\u22124°F');
  expect(displayTemperature(14, 'celsius')).toBe('\u221210°C');
  expect(displayTemperature(31, 'celsius')).toBe('\u22120.5°C');
});
