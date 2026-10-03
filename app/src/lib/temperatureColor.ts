import { palette } from '@design/tokens';
import { scaleColor } from '@design/themes/scale';

/** The active look's temperature scale; zero stays neutral in every look and display unit. */
export function temperatureColor(level: number): string {
  return scaleColor(palette.scale, level);
}
