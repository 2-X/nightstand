import { describe, expect, it } from 'vitest';
import { temperatureColor } from './temperatureColor';
import { fahrenheitToLevel, levelToFahrenheit } from './temperatureConversions';

describe('temperature colors', () => {
  it.each([[-10, '#5fa8e8'], [-5, '#8cc3ec'], [0, '#c4c9ce'], [5, '#f2b266'], [10, '#f07b4f']])(
    'uses the color stop at level %s', (level, color) => {
      expect(temperatureColor(Number(level))).toBe(color);
    },
  );
  it('interpolates fractional levels without rounding them first', () => {
    expect(temperatureColor(-7.5)).toBe('#76b6ea');
    expect(temperatureColor(2.5)).toBe('#dbbe9a');
    expect(temperatureColor(0.25)).not.toBe(temperatureColor(0));
  });
  it('clamps inputs and uses neutral for an unknown level', () => {
    expect(temperatureColor(-100)).toBe(temperatureColor(-10));
    expect(temperatureColor(100)).toBe(temperatureColor(10));
    expect(temperatureColor(NaN)).toBe(temperatureColor(0));
  });
  it('keeps the stored whole-degree neutral setting neutral', () => {
    expect(temperatureColor(fahrenheitToLevel(levelToFahrenheit(0)))).toBe('#c4c9ce');
  });
});
