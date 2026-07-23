import { describe, it, expect, beforeEach } from 'vitest';
import { useScheduleStore } from './scheduleStore';
import { useAppStore } from '@state/appStore.tsx';

// -------- helpers to build a fully-shaped Schedules object --------
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const mkAlarm = (o: any = {}) => ({
  time: '07:00',
  vibrationIntensity: 2,
  vibrationPattern: 'rise',
  duration: 10,
  enabled: true,
  alarmTemperature: 82,
  ...o,
});

const mkDay = (o: any = {}) => ({
  temperatures: { '06:00': 82, '07:00': 100 },
  power: { on: '21:00', off: '07:00', enabled: true, onTemperature: 60 },
  alarm: mkAlarm(),
  alarms: [mkAlarm()],
  ...o,
});

// Each day gets a distinct alarm time so a leak across days is detectable.
// Each side gets a distinct intensity so a leak across sides is detectable.
const mkSide = (intensity: number) =>
  Object.fromEntries(
    DAYS.map((d, i) => {
      const time = `0${i}:00`; // '00:00' .. '06:00'
      return [d, mkDay({
        alarm: mkAlarm({ time, vibrationIntensity: intensity }),
        alarms: [mkAlarm({ time, vibrationIntensity: intensity })],
      })];
    }),
  );

const mkSchedules = () => ({ left: mkSide(2), right: mkSide(9) }) as any;

const DEFAULT_DAYS_SELECTED = {
  sunday: false, monday: false, tuesday: false, wednesday: false,
  thursday: false, friday: false, saturday: false,
};

const resetStores = () => {
  useAppStore.setState({ side: 'left' });
  useScheduleStore.setState({
    selectedDay: 'sunday',
    selectedDayIndex: 0,
    selectedSchedule: undefined,
    originalSchedules: undefined,
    selectedAlarmIndex: 0,
    changesPresent: false,
    selectedDays: { ...DEFAULT_DAYS_SELECTED },
    accordionExpanded: undefined,
  });
};

beforeEach(resetStores);

// ---------------------------------------------------------------------------
// Hypothesis 2: multi-alarm edits must target selectedAlarmIndex, not alarm[0]
// ---------------------------------------------------------------------------
describe('multi-alarm edit targeting', () => {
  it('edits the selected alarm index, not alarms[0]', () => {
    const s = useScheduleStore.getState();
    s.setOriginalSchedules(mkSchedules());
    s.selectDay(0); // sunday
    useScheduleStore.getState().addAlarm(); // now 2 alarms, index -> 1
    expect(useScheduleStore.getState().selectedAlarmIndex).toBe(1);

    useScheduleStore.getState().updateSelectedAlarm({ time: '05:15' });

    const alarms = useScheduleStore.getState().getEditedAlarms();
    expect(alarms[1].time).toBe('05:15'); // target updated
    expect(alarms[0].time).toBe('00:00'); // sibling untouched
  });
});

// ---------------------------------------------------------------------------
// Hypothesis 2b: out-of-bounds selectedAlarmIndex must not corrupt/crash
// ---------------------------------------------------------------------------
describe('out-of-bounds selectedAlarmIndex', () => {
  it('updateSelectedAlarm is a no-op when the index points past the list', () => {
    const s = useScheduleStore.getState();
    s.setOriginalSchedules(mkSchedules());
    s.selectDay(0);
    useScheduleStore.getState().selectAlarm(5); // only 1 alarm exists

    expect(() => useScheduleStore.getState().updateSelectedAlarm({ time: '03:03' })).not.toThrow();
    const alarms = useScheduleStore.getState().getEditedAlarms();
    expect(alarms[0].time).toBe('00:00'); // unchanged
    expect(alarms.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Hypothesis 1: switching day discards edits and resets alarm index; no leak
// ---------------------------------------------------------------------------
describe('day switch resets the buffer', () => {
  it('discards unsaved alarm edits and resets selectedAlarmIndex when changing day', () => {
    const s = useScheduleStore.getState();
    s.setOriginalSchedules(mkSchedules());
    s.selectDay(0); // sunday
    useScheduleStore.getState().addAlarm(); // 2 alarms, index 1
    useScheduleStore.getState().updateSelectedAlarm({ time: '05:15' });
    expect(useScheduleStore.getState().changesPresent).toBe(true);

    useScheduleStore.getState().selectDay(1); // monday

    const st = useScheduleStore.getState();
    expect(st.selectedAlarmIndex).toBe(0);
    expect(st.getEditedAlarms().length).toBe(1); // monday has 1 alarm
    expect(st.getEditedAlarms()[0].time).toBe('01:00'); // monday's saved time, not sunday's edit
    expect(st.changesPresent).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Hypothesis 4: changesPresent accuracy
// ---------------------------------------------------------------------------
describe('changesPresent accuracy', () => {
  it('a real edit sets changesPresent true', () => {
    const s = useScheduleStore.getState();
    s.setOriginalSchedules(mkSchedules());
    s.selectDay(0);
    useScheduleStore.getState().updateSelectedAlarm({ time: '02:02' });
    expect(useScheduleStore.getState().changesPresent).toBe(true);
  });

  it('a no-op alarm edit on normal data leaves changesPresent false', () => {
    const s = useScheduleStore.getState();
    s.setOriginalSchedules(mkSchedules());
    s.selectDay(0);
    // sunday's saved alarm is enabled:true, time '00:00' - set to the same value
    useScheduleStore.getState().updateSelectedAlarm({ enabled: true });
    expect(useScheduleStore.getState().changesPresent).toBe(false);
  });

  it('a no-op alarm edit on LEGACY data (empty alarms[]) leaves changesPresent false', () => {
    // A day saved before multi-alarm support: legacy `alarm` set, `alarms` empty.
    const sched = mkSchedules();
    sched.left.sunday.alarms = [];
    const s = useScheduleStore.getState();
    s.setOriginalSchedules(sched);
    s.selectDay(0);
    // Set the enabled flag to the value it already has - a genuine no-op.
    useScheduleStore.getState().updateSelectedAlarm({ enabled: true });
    expect(useScheduleStore.getState().changesPresent).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// removeAlarm index clamping
// ---------------------------------------------------------------------------
describe('removeAlarm index clamp', () => {
  it('clamps selectedAlarmIndex into range after removing the last alarm', () => {
    const s = useScheduleStore.getState();
    s.setOriginalSchedules(mkSchedules());
    s.selectDay(0);
    useScheduleStore.getState().addAlarm(); // 2 alarms, index 1
    useScheduleStore.getState().removeAlarm(1); // remove selected -> 1 alarm
    const st = useScheduleStore.getState();
    expect(st.getEditedAlarms().length).toBe(1);
    expect(st.selectedAlarmIndex).toBeLessThanOrEqual(0);
    // The remaining alarm must be addressable
    expect(st.getEditedAlarms()[st.selectedAlarmIndex]).toBeTruthy();
  });
});
