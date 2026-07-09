// MUI's <Select> renders as blank when its value isn't exactly one of the
// MenuItem values. Schedules saved by other clients (or older builds) can
// hold values outside our canned option lists - e.g. an 8-second alarm
// duration when the list is 10..300 in steps of 10, or an 82°F transition
// when the level-display list only contains the 21 exact level->Fahrenheit
// values. These helpers make sure the current value is always displayable.

import {
  formatTemperature,
  MIN_TEMP_F,
  MAX_TEMP_F,
  TemperatureFormat,
} from './temperatureConversions.ts';
import _ from 'lodash';

/** Returns `values` sorted ascending, with `current` inserted if missing. */
export function withCurrentValue(values: number[], current: number | undefined): number[] {
  if (current === undefined || values.includes(current)) return [...values].sort((a, b) => a - b);
  return [...values, current].sort((a, b) => a - b);
}

export type TemperatureOption = { value: number; label: string };

/**
 * Build the option list for a temperature select, guaranteeing the current
 * value is selectable. In level display, several Fahrenheit values share a
 * label (82°F and 83°F are both level 0); when the current value's label
 * collides with a canonical option, that option adopts the current value
 * instead of listing a duplicate.
 */
export function buildTemperatureOptions(
  baseValues: number[],
  currentF: number | undefined,
  format: TemperatureFormat,
): TemperatureOption[] {
  const options = baseValues.map((value) => ({ value, label: formatTemperature(value, format) }));
  if (
    currentF === undefined ||
    currentF < MIN_TEMP_F ||
    currentF > MAX_TEMP_F ||
    options.some((o) => o.value === currentF)
  ) {
    return options;
  }
  const label = formatTemperature(currentF, format);
  const sameLabel = options.find((o) => o.label === label);
  if (sameLabel) {
    sameLabel.value = currentF;
    return options;
  }
  return _.sortBy([...options, { value: currentF, label }], 'value');
}
