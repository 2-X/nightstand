import { describe, expect, it } from 'vitest';
import { buildTemperatureOptions, withCurrentValue } from './selectOptions.ts';
import { levelToFahrenheit } from './temperatureConversions.ts';
import _ from 'lodash';

const LEVEL_VALUES = _.range(-10, 11).map(levelToFahrenheit);
const FAHRENHEIT_VALUES = _.range(55, 111);

describe('withCurrentValue', () => {
  it('returns the list unchanged when the current value is present', () => {
    expect(withCurrentValue([10, 20, 30], 20)).toEqual([10, 20, 30]);
  });

  it('inserts a missing current value in sorted position', () => {
    expect(withCurrentValue([10, 20, 30], 8)).toEqual([8, 10, 20, 30]);
    expect(withCurrentValue([10, 20, 30], 12)).toEqual([10, 12, 20, 30]);
  });

  it('handles undefined current value', () => {
    expect(withCurrentValue([30, 10, 20], undefined)).toEqual([10, 20, 30]);
  });
});

describe('buildTemperatureOptions', () => {
  it('keeps canonical options when the current value is in the list', () => {
    const options = buildTemperatureOptions(FAHRENHEIT_VALUES, 82, 'fahrenheit');
    expect(options).toHaveLength(FAHRENHEIT_VALUES.length);
    expect(options.find((o) => o.value === 82)?.label).toBe('82°F');
  });

  it('makes an off-list value selectable in level display by adopting it into the matching label', () => {
    // 82°F is level 0, but the canonical level-0 option is 83°F. The select
    // must still display a stored 82°F schedule as "0".
    const options = buildTemperatureOptions(LEVEL_VALUES, 82, 'level');
    expect(options).toHaveLength(LEVEL_VALUES.length);
    const level0 = options.find((o) => o.label === '0');
    expect(level0?.value).toBe(82);
    expect(options.filter((o) => o.label === '0')).toHaveLength(1);
  });

  it('every stored Fahrenheit value is displayable in level mode', () => {
    for (const f of FAHRENHEIT_VALUES) {
      const options = buildTemperatureOptions(LEVEL_VALUES, f, 'level');
      expect(options.some((o) => o.value === f)).toBe(true);
    }
  });

  it('ignores out-of-range current values', () => {
    expect(buildTemperatureOptions(LEVEL_VALUES, 300, 'level')).toHaveLength(LEVEL_VALUES.length);
    expect(buildTemperatureOptions(LEVEL_VALUES, undefined, 'level')).toHaveLength(LEVEL_VALUES.length);
  });
});
