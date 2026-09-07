import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  RecurringAlarmSchema,
  SmartWakeSchema,
  SMART_WAKE_DEFAULT_WINDOW_MINUTES,
  SMART_WAKE_MIN_WINDOW_MINUTES,
  SMART_WAKE_MAX_WINDOW_MINUTES,
} from './schedulesSchema.js';

// Migration safety: adding optional `smartWake` must not change how any
// existing alarm row parses. An old row with no smartWake key parses to the
// exact same object (smartWake stays undefined), and enabling smart wake is
// purely additive.

const legacyAlarm = {
  id: 'legacy-1',
  time: '07:00',
  recurrence: { kind: 'daily' as const },
  vibration: { intensity: 60, duration: 90, pattern: 'rise' as const },
  enabled: true,
};

describe('smartWake schema migration safety', () => {
  it('parses an existing alarm with no smartWake key unchanged', () => {
    const parsed = RecurringAlarmSchema.parse(legacyAlarm);
    assert.equal('smartWake' in parsed && parsed.smartWake !== undefined, false);
    assert.deepEqual(parsed, legacyAlarm);
  });

  it('parses an alarm that also carries warmRamp + smartWake', () => {
    const modern = {
      ...legacyAlarm,
      id: 'modern-1',
      warmRampMinutes: 20,
      smartWake: { enabled: true, windowMinutes: 45 },
    };
    const parsed = RecurringAlarmSchema.parse(modern);
    assert.deepEqual(parsed.smartWake, { enabled: true, windowMinutes: 45 });
    assert.equal(parsed.warmRampMinutes, 20);
  });

  it('defaults windowMinutes when only enabled is provided', () => {
    const parsed = SmartWakeSchema.parse({ enabled: true });
    assert.equal(parsed.windowMinutes, SMART_WAKE_DEFAULT_WINDOW_MINUTES);
  });

  it('accepts the window bounds and rejects out-of-range values', () => {
    assert.doesNotThrow(() => SmartWakeSchema.parse({ enabled: true, windowMinutes: SMART_WAKE_MIN_WINDOW_MINUTES }));
    assert.doesNotThrow(() => SmartWakeSchema.parse({ enabled: true, windowMinutes: SMART_WAKE_MAX_WINDOW_MINUTES }));
    assert.throws(() => SmartWakeSchema.parse({ enabled: true, windowMinutes: SMART_WAKE_MIN_WINDOW_MINUTES - 1 }));
    assert.throws(() => SmartWakeSchema.parse({ enabled: true, windowMinutes: SMART_WAKE_MAX_WINDOW_MINUTES + 1 }));
  });

  it('rejects unknown keys on smartWake (strict)', () => {
    assert.throws(() => SmartWakeSchema.parse({ enabled: true, windowMinutes: 30, bogus: 1 }));
  });

  it('rejects a non-integer window', () => {
    assert.throws(() => SmartWakeSchema.parse({ enabled: true, windowMinutes: 30.5 }));
  });

  it('keeps a disabled smartWake with an explicit window', () => {
    const parsed = SmartWakeSchema.parse({ enabled: false, windowMinutes: 15 });
    assert.deepEqual(parsed, { enabled: false, windowMinutes: 15 });
  });
});
