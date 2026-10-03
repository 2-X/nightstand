import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

afterEach(() => {
  delete document.documentElement.dataset.theme;
  vi.resetModules();
});

describe.each(['nightstand', 'classic', 'glass'] as const)('in the %s look', id => {
  it('marks now with the neutral marker and never paints the accent', async () => {
    document.documentElement.dataset.theme = id;
    vi.resetModules();
    const { palette } = await import('@design/tokens');
    const { default: DialRing } = await import('./DialRing');
    const { container } = render(<DialRing isOn targetLevel={ 4 } currentLevel={ -2 }/>);
    expect(palette.accent).not.toBe(palette.lamp);
    expect(container.querySelector('line[data-notch]')).toHaveAttribute('stroke', palette.lamp);
    const painted = [...container.querySelectorAll('[stroke], [fill]')]
      .flatMap(node => [node.getAttribute('stroke'), node.getAttribute('fill')]);
    expect(painted).not.toContain(palette.accent);
  });
});
