import { afterEach, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useTweenedNumber } from './useTweenedNumber';

const prefersReducedMotion = (reduce: boolean) => vi.stubGlobal('matchMedia', (query: string) => ({
  matches: reduce && query.includes('prefers-reduced-motion: reduce'),
  media: query,
  onchange: null,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  addListener: () => undefined,
  removeListener: () => undefined,
  dispatchEvent: () => false,
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('jumps straight to a new value when reduced motion is requested', () => {
  prefersReducedMotion(true);
  const { result, rerender } = renderHook(({ target }) => useTweenedNumber(target), { initialProps: { target: 0 } });
  rerender({ target: 20 });
  expect(result.current).toBe(20);
});

it('eases toward a new value otherwise', () => {
  prefersReducedMotion(false);
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
  const { result, rerender } = renderHook(({ target }) => useTweenedNumber(target), { initialProps: { target: 0 } });
  rerender({ target: 20 });
  act(() => { vi.advanceTimersByTime(100); });
  expect(result.current).toBeGreaterThan(0);
  expect(result.current).toBeLessThan(20);
  act(() => { vi.advanceTimersByTime(1_000); });
  expect(result.current).toBe(20);
});

it('reaches later values after a value that is not a number', () => {
  prefersReducedMotion(false);
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
  const { result, rerender } = renderHook(({ target }) => useTweenedNumber(target), { initialProps: { target: 0 } });
  rerender({ target: NaN });
  act(() => { vi.advanceTimersByTime(1_000); });
  rerender({ target: 12 });
  act(() => { vi.advanceTimersByTime(1_000); });
  expect(result.current).toBe(12);
});
