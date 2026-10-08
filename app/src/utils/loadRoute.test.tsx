import { lazy, Suspense } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { loadRoute } from './loadRoute';

beforeEach(() => {
  sessionStorage.clear();
  vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
});
afterEach(() => vi.restoreAllMocks());

const chunkError = () => new TypeError('Failed to fetch dynamically imported module: /assets/Settings-old.js');
const brokenImport = () => Promise.reject(chunkError());

it('reloads a failed lazy route and keeps its loading fallback while navigating', async () => {
  const reload = vi.fn();
  const Page = lazy(() => loadRoute(() => Promise.reject<{ default: () => React.JSX.Element }>(chunkError()), reload));
  render(<Suspense fallback={ <span>Loading route</span> }><Page/></Suspense>);
  await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  expect(screen.getByText('Loading route')).toBeVisible();
});

it('suppresses another reload across route loaders until the time window expires', async () => {
  const reload = vi.fn();
  void loadRoute(brokenImport, reload).catch(() => {});
  await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  await expect(loadRoute(brokenImport, reload)).rejects.toThrow(/dynamically imported/);
  expect(reload).toHaveBeenCalledTimes(1);
  vi.mocked(Date.now).mockReturnValue(1_300_001);
  void loadRoute(brokenImport, reload).catch(() => {});
  await waitFor(() => expect(reload).toHaveBeenCalledTimes(2));
});

it.each([
  'error loading dynamically imported module: /assets/old.js',
  'Importing a module script failed.',
  'Unexpected token \'<\'',
  'Unable to preload CSS for /assets/old.css',
  'Loading chunk 42 failed.',
])('recovers browser chunk error: %s', async message => {
  const reload = vi.fn();
  void loadRoute(() => Promise.reject(new Error(message)), reload).catch(() => {});
  await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
});

it('returns loaded modules without clearing the reload guard', async () => {
  const reload = vi.fn();
  void loadRoute(brokenImport, reload).catch(() => {});
  await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  const module = { default: 'page' };
  expect(await loadRoute(() => Promise.resolve(module), reload)).toBe(module);
  await expect(loadRoute(brokenImport, reload)).rejects.toThrow();
  expect(reload).toHaveBeenCalledTimes(1);
});

it('passes through module execution errors without reloading', async () => {
  const reload = vi.fn();
  const error = new Error('Invalid page configuration');
  await expect(loadRoute(() => Promise.reject(error), reload)).rejects.toBe(error);
  expect(reload).not.toHaveBeenCalled();
});

it.each(['getItem', 'setItem'] as const)('does not risk a reload loop when storage %s fails', async method => {
  vi.spyOn(Storage.prototype, method).mockImplementation(() => { throw new Error('Storage unavailable'); });
  const reload = vi.fn();
  await expect(loadRoute(brokenImport, reload)).rejects.toThrow(/dynamically imported/);
  expect(reload).not.toHaveBeenCalled();
});
