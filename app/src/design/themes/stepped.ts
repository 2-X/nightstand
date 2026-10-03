import type { TemperatureScale } from './types';

// The older apps' four bands; the two warm ones lightened to reach AA on a selected tile.
export const STEPPED_SCALE: TemperatureScale = {
  kind: 'stepped',
  neutral: '#E8EAED',
  bands: [[70, '#2196F3'], [82, '#5393FF'], [95, '#E26464']],
  above: '#F25555',
};
