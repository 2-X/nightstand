import { describe, expect, it } from 'vitest';
import { palette } from '@design/tokens';
import { scaleColor } from '@design/themes/scale';
import { temperatureColor } from './temperatureColor';
import { fahrenheitToLevel, levelToFahrenheit } from './temperatureConversions';

describe('temperature colors', () => {
  it("reads the active look's scale", () => {
    for (let level = -10; level <= 10; level += 0.25) expect(temperatureColor(level)).toBe(scaleColor(palette.scale, level));
  });
  it('clamps inputs and uses neutral for an unknown level', () => {
    expect(temperatureColor(-100)).toBe(temperatureColor(-10));
    expect(temperatureColor(100)).toBe(temperatureColor(10));
    expect(temperatureColor(NaN)).toBe(temperatureColor(0));
  });
  it('keeps the stored whole-degree neutral setting neutral', () => {
    expect(temperatureColor(fahrenheitToLevel(levelToFahrenheit(0)))).toBe(temperatureColor(0));
  });
});
