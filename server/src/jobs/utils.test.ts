import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  compareTimes,
  getDayIndexForTime,
  getDayOfWeekIndex,
  getPowerOffDayIndex,
  scheduleWrapsToNextDay,
} from './utils.js';

const SUNDAY = 0;
const MONDAY = 1;
const TUESDAY = 2;
const SATURDAY = 6;

describe('compareTimes', () => {
  it('orders times within a day', () => {
    assert.ok(compareTimes('09:00', '21:00') < 0);
    assert.ok(compareTimes('21:00', '09:00') > 0);
    assert.equal(compareTimes('07:30', '07:30'), 0);
  });

  it('compares minutes, not just hours', () => {
    assert.ok(compareTimes('07:05', '07:30') < 0);
  });
});

describe('scheduleWrapsToNextDay', () => {
  it('wraps when the off time is earlier in the day than the on time', () => {
    assert.equal(scheduleWrapsToNextDay({ on: '21:00', off: '09:00' }), true);
    // A late bedtime with an afternoon off still wraps: this is the case the
    // old fixed noon cutoff got wrong.
    assert.equal(scheduleWrapsToNextDay({ on: '23:00', off: '13:00' }), true);
  });

  it('does not wrap for a window that opens and closes the same day', () => {
    assert.equal(scheduleWrapsToNextDay({ on: '09:00', off: '11:00' }), false);
    assert.equal(scheduleWrapsToNextDay({ on: '00:30', off: '08:00' }), false);
    assert.equal(scheduleWrapsToNextDay({ on: '13:00', off: '15:00' }), false);
  });

  it('treats an off equal to on as a full 24 hour window', () => {
    assert.equal(scheduleWrapsToNextDay({ on: '21:00', off: '21:00' }), true);
  });
});

describe('getPowerOffDayIndex', () => {
  it('closes an ordinary overnight window the next morning', () => {
    assert.equal(getPowerOffDayIndex('monday', { on: '21:00', off: '09:00' }), TUESDAY);
  });

  // Previously the noon cutoff put this off job on Saturday, ten hours before
  // its own power on, so the bed ran until the following Saturday.
  it('closes a late-night window with an afternoon off on the next day', () => {
    assert.equal(getPowerOffDayIndex('saturday', { on: '23:00', off: '13:00' }), SUNDAY);
  });

  it('closes a morning window the same morning', () => {
    assert.equal(getPowerOffDayIndex('monday', { on: '09:00', off: '11:00' }), MONDAY);
  });

  it('closes an after-midnight window the same day', () => {
    assert.equal(getPowerOffDayIndex('monday', { on: '00:30', off: '08:00' }), MONDAY);
  });

  it('wraps saturday to sunday rather than running off the end of the week', () => {
    assert.equal(getPowerOffDayIndex('saturday', { on: '21:00', off: '09:00' }), SUNDAY);
  });
});

describe('getDayIndexForTime', () => {
  it('keeps a time at or after power on on the schedule day', () => {
    assert.equal(getDayIndexForTime('monday', '23:00', '21:00'), MONDAY);
    assert.equal(getDayIndexForTime('monday', '21:00', '21:00'), MONDAY);
  });

  it('moves a time before power on to the next day', () => {
    assert.equal(getDayIndexForTime('monday', '06:30', '21:00'), TUESDAY);
    assert.equal(getDayIndexForTime('monday', '03:00', '22:00'), TUESDAY);
  });

  // The alarm's day used to be derived from power.off, so an off time on the
  // far side of noon (13:00) put a 06:30 alarm on monday, before its own
  // schedule had even started. It belongs to tuesday either way.
  it('places an early alarm on the morning after power on', () => {
    assert.equal(getDayIndexForTime('monday', '06:30', '22:00'), TUESDAY);
    assert.notEqual(getDayIndexForTime('monday', '06:30', '22:00'), MONDAY);
  });

  it('keeps a midday adjustment inside a morning window on the same day', () => {
    assert.equal(getDayIndexForTime('monday', '10:00', '09:00'), MONDAY);
  });

  it('agrees with the power off day for the same schedule', () => {
    const power = { on: '22:00', off: '06:00' };
    assert.equal(
      getDayIndexForTime('monday', power.off, power.on),
      getPowerOffDayIndex('monday', power),
    );
  });

  it('wraps from saturday to sunday', () => {
    assert.equal(getDayIndexForTime('saturday', '06:30', '22:00'), SUNDAY);
    assert.equal(getDayOfWeekIndex('saturday'), SATURDAY);
  });
});
