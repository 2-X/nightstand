import { expect, it } from 'vitest';
import { addDays, rhythmNightBounds, wallClock } from '@api/rhythmTimes';
import { check, fuzzCase, FUZZ_RUNS, FUZZ_SEED, clock, random, sleepInput, SLEEP_CASES } from '../../../../../server/src/testing/smartFuzz';
import { curveSummary, previewCurves } from './smartPreview';

it(`fuzzes chart series, markers, domain and summary (${FUZZ_RUNS} runs, seed ${FUZZ_SEED})`, () => {
  const next = random();
  for (let run = 0; run < FUZZ_RUNS + SLEEP_CASES.length; run++) {
    const fixture = SLEEP_CASES[run - FUZZ_RUNS];
    const { rhythm, date, timeZone } = sleepInput(next, fixture);
    if (!fixture && next(0, 2) === 0) {
      const [hour, minute] = rhythm.night.power.on.split(':').map(Number);
      const duration = (Number(rhythm.wake.slice(0, 2)) * 60 + Number(rhythm.wake.slice(3)) - hour * 60 - minute + 1440) % 1440;
      if (duration > 1) rhythm.night.power.off = clock(hour * 60 + minute + next(1, duration - 1));
    }
    const input = { night: rhythm.night, wake: rhythm.wake, smart: rhythm.smart, date, timeZone, trackingOn: !!next(0, 1) };
    fuzzCase(input, run, () => {
      const model = previewCurves(input);
      const { from, to } = model.domain;
      const bounds = rhythmNightBounds(input.date, input.night.power, input.timeZone);
      expect(model.anchors.bedtime).toEqual(bounds.start);
      expect(model.anchors.powerOff).toEqual(bounds.end);
      const wakeDate = input.wake < input.night.power.on ? addDays(input.date, 1) : input.date;
      expect(model.markers.wake).toEqual(input.wake === input.night.power.off ? bounds.end
        : wallClock(wakeDate, input.wake, input.timeZone));
      if (model.anchors.powerOff <= model.anchors.bedtime) {
        expect(model.points).toEqual([]);
        expect(model.series).toEqual([]);
        expect(curveSummary(model.points, String, model.anchors)).toBe('');
        return;
      }
      check(model.anchors.wake >= model.anchors.bedtime && model.anchors.wake <= model.anchors.powerOff, 'wake outside sleep');
      check(from <= model.anchors.bedtime && to >= model.markers.wake && to >= model.anchors.powerOff, 'domain truncates sleep');
      for (const marker of Object.values(model.markers)) check(marker >= from && marker <= to, 'marker outside domain');
      model.series.forEach((point, index) => {
        check(Number.isFinite(point.at.getTime()) && Number.isFinite(point.level), 'nonfinite chart series');
        if (index) check(point.at >= model.series[index - 1].at, 'unsorted chart series');
        check(point.level >= -10 && point.level <= 10, 'chart level outside bounds');
      });
      check(model.series.length === model.points.length + 1, 'missing display endpoint');
      check(model.points.every(point => point.at < model.anchors.powerOff), 'command at turn off');
      const last = model.series[model.series.length - 1];
      expect(last.at).toEqual(model.anchors.powerOff);
      expect(last.level).toBe(model.series[model.series.length - 2].level);
      const summary = curveSummary(model.points, String, model.anchors);
      expect(summary).toMatch(/^-?\d+ at bedtime, -?\d+ overnight, -?\d+ at wake-up$/);
      check(summary.match(/-?\d+/g)!.every(value => Number(value) >= -10 && Number(value) <= 10), 'summary level outside bounds');
      if (model.band) check(model.band.from >= from && model.band.to <= to, 'cool-down band outside domain');
    });
  }
});
