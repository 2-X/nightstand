import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

// A path join, not new URL(`../${file}`, import.meta.url): Vite rewrites that form into a glob import.
const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = (file: string) => readFileSync(path.join(srcDir, file), 'utf8');

// Parts that only show values. Colour means live, and the accent marks controls, so these never use it.
const VALUE_PARTS = [
  'pages/ControlTempPage/DialRing.tsx',
  'pages/ControlTempPage/TemperatureLabel.tsx',
  'components/VitalsLineChart.tsx',
  'design/TimeSeriesChart.tsx',
  'components/SleepFitnessCard.tsx',
  'components/SleepStagesCard.tsx',
  'lib/temperatureColor.ts',
  'components/MovementChart.tsx',
];
const ACCENT = /palette\.accent|primary\.main|palette\.primary|color="primary"/;

it.each(VALUE_PARTS)('%s never paints in the accent', file => {
  expect(source(file)).not.toMatch(ACCENT);
});

// These hold controls and values side by side: their fills draw the values.
it.each(['pages/DataPage/SleepPage/WeekStrip.tsx', 'pages/DataPage/SleepPage/WeeklyScheduleBars.tsx'])(
  '%s fills its bars with the neutral marker, not the accent', file => {
    expect(source(file)).not.toMatch(/bgcolor:[^,}]*palette\.accent/);
    expect(source(file)).toMatch(/bgcolor:[^,}]*palette\.lamp/);
  },
);

it.each([
  'components/SideControl.tsx', 'components/BedTabs.tsx', 'pages/SchedulePage/rhythms/RhythmPicker.tsx',
  'pages/SchedulePage/rhythms/MultiDateSheet.tsx', 'pages/SchedulePage/rhythms/UndoBar.tsx',
])('%s marks its controls in the accent', file => {
  expect(source(file)).toMatch(/palette\.accent/);
  expect(source(file)).not.toMatch(/palette\.lamp/);
});
