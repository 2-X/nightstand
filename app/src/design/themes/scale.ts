import { levelToFahrenheit } from '../../lib/temperatureConversions';
import type { TemperatureScale } from './types';

// Within half a level of zero the bed is at neutral, in every look.
const NEUTRAL_HALF_WIDTH = 0.5;

const mix = (from: string, to: string, fraction: number) => '#' + [1, 3, 5].map(offset => {
  const start = parseInt(from.slice(offset, offset + 2), 16);
  const end = parseInt(to.slice(offset, offset + 2), 16);
  return Math.round(start + (end - start) * fraction).toString(16).padStart(2, '0');
}).join('');

// Always lowercase '#rrggbb', so colours from either kind of scale compare as strings.
export function scaleColor(scale: TemperatureScale, level: number): string {
  const clamped = Number.isNaN(level) ? 0 : Math.max(-10, Math.min(10, level));
  if (scale.kind === 'continuous') {
    const { stops } = scale;
    // Held at the end stops, so a scale that stops short of 10 never extrapolates.
    const position = Math.max(stops[0][0], Math.min(stops[stops.length - 1][0], clamped));
    const upperIndex = Math.max(1, stops.findIndex(([stop]) => stop >= position));
    const [lower, from] = stops[upperIndex - 1];
    const [upper, to] = stops[upperIndex];
    return mix(from, to, (position - lower) / (upper - lower));
  }
  if (Math.abs(clamped) < NEUTRAL_HALF_WIDTH) return scale.neutral.toLowerCase();
  const fahrenheit = levelToFahrenheit(clamped);
  return (scale.bands.find(([maxFahrenheit]) => fahrenheit <= maxFahrenheit)?.[1] ?? scale.above).toLowerCase();
}
