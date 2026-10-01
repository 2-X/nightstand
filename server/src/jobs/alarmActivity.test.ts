import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import schedule from 'node-schedule';
import { nightAlarmPending, resetAlarmActivity, rhythmNightAlarms, trackAlarm } from './alarmActivity.js';
import { setRebuilding } from './rebuildState.js';

const MINUTE = 60_000;
const NIGHT = rhythmNightAlarms('left', '2026-09-29');
const inMinutes = (minutes: number) => new Date(Date.now() + minutes * MINUTE);

afterEach(() => {
  for (const name of Object.keys(schedule.scheduledJobs)) schedule.cancelJob(name);
  resetAlarmActivity();
  setRebuilding(false);
});

describe('nightAlarmPending', () => {
  it('counts an alarm of the night due by the given time', () => {
    schedule.scheduleJob('rhythm-left-2026-09-29-alarm-0700-0', inMinutes(20), () => {});
    assert.equal(nightAlarmPending('left', inMinutes(30), NIGHT), true);
    assert.equal(nightAlarmPending('left', inMinutes(10), NIGHT), false);
  });

  it("ignores another night's alarms and the other side's", () => {
    schedule.scheduleJob('rhythm-left-2026-09-30-alarm-0700-0', inMinutes(20), () => {});
    schedule.scheduleJob('rhythm-right-2026-09-29-alarm-0700-0', inMinutes(20), () => {});
    assert.equal(nightAlarmPending('left', inMinutes(30), NIGHT), false);
  });

  it('counts the one-time alarm, which can end any night', () => {
    schedule.scheduleJob('left-one-off-alarm', inMinutes(20), () => {});
    assert.equal(nightAlarmPending('left', inMinutes(30), NIGHT), true);
  });

  it('counts an alarm while it rings, and not after', async () => {
    let ring: (ms: number) => void = () => {};
    void trackAlarm('left', 'rhythm-left-2026-09-29-alarm-0700-0', () => new Promise<number>(resolve => { ring = resolve; }));
    assert.equal(nightAlarmPending('left', new Date(), NIGHT), true);
    ring(0);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(nightAlarmPending('left', new Date(), NIGHT), false);
  });

  it('counts as pending while the jobs are re-planned, when the list is empty', () => {
    setRebuilding(true);
    assert.equal(Object.keys(schedule.scheduledJobs).length, 0);
    assert.equal(nightAlarmPending('left', inMinutes(30), NIGHT), true);
  });
});
