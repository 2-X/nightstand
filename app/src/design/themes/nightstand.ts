import { STEPPED_SCALE } from './stepped';
import type { ThemeTokens } from './types';

// The look of 3.3.2, with AA contrast, one corner and flat cards.
export const nightstand: ThemeTokens = {
  id: 'nightstand',
  radius: 7,
  palette: {
    bg: { base: '#000000', elevated: '#0A0A0A', raised: '#141414', selected: '#172028', hover: 'rgba(255,255,255,0.08)' },
    border: { subtle: '#1E1E1E', control: '#616161', medium: 'rgba(255,255,255,0.12)' },
    text: { primary: '#FFFFFF', secondary: 'rgba(255,255,255,0.7)', tertiary: '#9E9E9E', disabled: 'rgba(255,255,255,0.5)' },
    accent: '#90CAF9',
    lamp: '#FFFFFF',
    ember: '#172028',
    appBar: '#0B0B0B',
    dial: {
      trackOff: '#616161', tick: '#424242', tickMajor: '#616161', tickZero: '#9E9E9E', tickOff: '#2B2B2B', tickMajorOff: '#383838',
      ghostOpacity: 0.22, haloOpacity: 0.4,
    },
    step: { cool: '#616161', warm: '#616161', disabled: '#424242' },
    power: { offBg: '#000000', offText: '#90CAF9', offBorder: 'rgba(144,202,249,0.5)', nightBg: '#000000' },
    tile: { selectedBorder: 'rgba(144,202,249,0.7)' },
    status: { ok: '#66BB6A', warn: '#FFA726', error: '#F44336', info: '#29B6F6' },
    stage: { awake: '#E8EAED', rem: '#7DA6FF', light: '#3B6CD6', deep: '#1F4ED8' },
    scale: STEPPED_SCALE,
  },
  type: {
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif',
    font: 'system',
    bodyLetterSpacing: '0.05em',
    headingWeight: 500,
    mediumWeight: 500,
    numeralWeight: 500,
    numeralTrackingEm: 0,
    controlCase: { textTransform: 'none', letterSpacing: 'normal' },
    sectionLabel: { fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase' },
  },
};
