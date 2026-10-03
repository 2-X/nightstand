import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { loadThemeFonts } from './fonts';

const added: FakeFontFace[] = [];
let pending = false;
let rejecting = false;
// Set to hold every load until the test lets them finish.
let late: Promise<void> | undefined;

class FakeFontFace {
  family: string;
  source: string;
  descriptors: FontFaceDescriptors;
  constructor(family: string, source: string, descriptors: FontFaceDescriptors) {
    this.family = family;
    this.source = source;
    this.descriptors = descriptors;
  }
  get weight() {
    return this.descriptors.weight;
  }
  load() {
    if (rejecting) return Promise.reject(new Error('network'));
    if (late) return late.then(() => this);
    return pending ? new Promise(() => undefined) : Promise.resolve(this);
  }
}

beforeEach(() => {
  added.length = 0;
  pending = false;
  rejecting = false;
  late = undefined;
  vi.stubGlobal('FontFace', FakeFontFace);
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: {
      add: (face: FakeFontFace) => added.push(face),
      delete: (face: FakeFontFace) => added.includes(face) && !!added.splice(added.indexOf(face), 1),
    },
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete (document as { fonts?: unknown }).fonts;
});

it('adds nothing for a look in the system font', async () => {
  await loadThemeFonts('system');
  expect(added).toEqual([]);
});

it.each([
  ['roboto', 'Roboto', ['300', '400', '500', '700']],
  ['geist', 'Geist', ['200', '400', '500', '600']],
] as const)('adds %s from files bundled with the app', async (font, family, weights) => {
  await loadThemeFonts(font);
  expect(added.map(face => face.weight)).toEqual(weights);
  for (const face of added) {
    expect(face.family).toBe(family);
    expect(face.source).toMatch(/^url\(.+\.woff2\) format\('woff2'\)$/);
    expect(face.source).not.toMatch(/:\/\//);
  }
});

it('does not hold the first render when a font never loads', async () => {
  pending = true;
  await expect(loadThemeFonts('roboto', 20)).resolves.toBeUndefined();
});

it('waits one second by default for a font that never loads', async () => {
  vi.useFakeTimers();
  pending = true;
  let done = false;
  void loadThemeFonts('roboto').then(() => { done = true; });
  await vi.advanceTimersByTimeAsync(999);
  expect(done).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(done).toBe(true);
});

it('stops the wait once the fonts load, and keeps them', async () => {
  vi.useFakeTimers();
  await loadThemeFonts('roboto');
  expect(vi.getTimerCount()).toBe(0);
  expect(added).toHaveLength(4);
});

it('keeps the fallback for the page load when the fonts arrive after the deadline', async () => {
  vi.useFakeTimers();
  let arrive: () => void = () => undefined;
  late = new Promise(resolve => { arrive = resolve; });
  let done = false;
  void loadThemeFonts('geist').then(() => { done = true; });
  await vi.advanceTimersByTimeAsync(1000);
  expect(done).toBe(true);
  expect(added).toEqual([]);
  arrive();
  await vi.advanceTimersByTimeAsync(0);
  expect(added).toEqual([]);
});

it('renders on when a font fails to load', async () => {
  vi.useFakeTimers();
  rejecting = true;
  await expect(loadThemeFonts('geist')).resolves.toBeUndefined();
  expect(vi.getTimerCount()).toBe(0);
});

it.each(['Roboto-OFL.txt', 'Geist-OFL.txt'])('ships %s with the app', file => {
  const text = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../public/licenses', file), 'utf8');
  expect(text).toMatch(/open font license/i);
});
