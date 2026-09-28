const stops = [
  [-10, '#5FA8E8'], [-5, '#8CC3EC'], [0, '#C4C9CE'], [5, '#F2B266'], [10, '#F07B4F'],
] as const;

/** A continuous temperature scale; zero stays neutral in every display unit. */
export function temperatureColor(level: number): string {
  const clamped = Number.isNaN(level) ? 0 : Math.max(-10, Math.min(10, level));
  const upperIndex = Math.max(1, stops.findIndex(([position]) => position >= clamped));
  const [lower, from] = stops[upperIndex - 1];
  const [upper, to] = stops[upperIndex];
  const fraction = (clamped - lower) / (upper - lower);
  return '#' + [1, 3, 5].map(offset => {
    const start = parseInt(from.slice(offset, offset + 2), 16);
    const end = parseInt(to.slice(offset, offset + 2), 16);
    return Math.round(start + (end - start) * fraction).toString(16).padStart(2, '0');
  }).join('');
}
