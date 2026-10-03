import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { THEME_IDS } from '@design/themes/ids';

vi.mock('@api/deviceStatus.ts', () => ({ postDeviceStatus: vi.fn(), useDeviceStatus: () => ({ data: undefined }) }));
vi.mock('@api/settings.ts', () => ({ useSettings: () => ({ data: { timeZone: 'UTC', left: { awayMode: false } } }) }));
vi.mock('@state/appStore', () => ({ useAppStore: () => ({ side: 'left', setIsUpdating: vi.fn() }) }));
vi.mock('./TemperatureButtons', () => ({ default: () => <button>Temperature stepper</button> }));
vi.mock('./useBedCaption', () => ({ useBedCaption: () => ['Stays on until you turn it off'] }));

afterEach(() => {
  delete document.documentElement.dataset.theme;
  vi.resetModules();
});

const on = { isOn: true, targetTemperatureF: 90, currentTemperatureF: 75 };
// Where each mark sits, without its colour.
const slots = (container: HTMLElement) => [...container.querySelectorAll('[data-dial] svg *')]
  .map(node => [node.tagName, ...['d', 'cx', 'cy', 'r', 'x1', 'y1', 'x2', 'y2'].map(name => node.getAttribute(name))].join(' '));
const painted = (container: HTMLElement) => [...container.querySelectorAll('[data-dial] svg [stroke], [data-dial] svg [fill]')]
  .flatMap(node => [node.getAttribute('stroke'), node.getAttribute('fill')])
  .filter((colour): colour is string => !!colour && colour !== 'none');

describe.each(THEME_IDS)('a paused side in the %s look', id => {
  it('draws its numeral, span and target grey, each where a live one sits', async () => {
    document.documentElement.dataset.theme = id;
    vi.resetModules();
    const { palette } = await import('@design/tokens');
    const { temperatureColor } = await import('@lib/temperatureColor');
    const { fahrenheitToLevel } = await import('@lib/temperatureConversions.ts');
    const { default: TemperatureDial } = await import('./TemperatureDial');
    const scale = new Set(Array.from({ length: 41 }, (_, i) => temperatureColor(i / 2 - 10)));

    const live = render(<TemperatureDial status={ on } refetch={ vi.fn() } format="level"/>);
    const liveSlots = slots(live.container);
    expect(painted(live.container)).toContain(temperatureColor(fahrenheitToLevel(on.targetTemperatureF)));
    live.unmount();

    const { container } = render(<TemperatureDial status={ on } paused refetch={ vi.fn() } format="level"/>);
    expect(screen.getByRole('heading', { level: 2 })).toHaveStyle({ color: palette.text.secondary });
    expect(container.querySelector('[data-dial] g[data-band="fill"]')).not.toBeNull();
    expect(container.querySelector('[data-dial] circle[data-target]')).toHaveAttribute('fill', palette.text.tertiary);
    // The now notch keeps the neutral marker, which can be the scale's own neutral.
    expect(painted(container).filter(colour => colour !== palette.lamp && scale.has(colour.toLowerCase()))).toEqual([]);
    expect(slots(container)).toEqual(liveSlots);
    // A paused side is still on, so its steppers stay.
    expect(screen.getByText('Temperature stepper')).toBeInTheDocument();
  });
});
