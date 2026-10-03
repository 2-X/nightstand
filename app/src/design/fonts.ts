import robotoLight from '@fontsource/roboto/files/roboto-latin-300-normal.woff2?url';
import robotoRegular from '@fontsource/roboto/files/roboto-latin-400-normal.woff2?url';
import robotoMedium from '@fontsource/roboto/files/roboto-latin-500-normal.woff2?url';
import robotoBold from '@fontsource/roboto/files/roboto-latin-700-normal.woff2?url';
import geistExtraLight from '@fontsource/geist-sans/files/geist-sans-latin-200-normal.woff2?url';
import geistRegular from '@fontsource/geist-sans/files/geist-sans-latin-400-normal.woff2?url';
import geistMedium from '@fontsource/geist-sans/files/geist-sans-latin-500-normal.woff2?url';
import geistSemiBold from '@fontsource/geist-sans/files/geist-sans-latin-600-normal.woff2?url';
import type { ThemeFont } from './themes/types';

// Bundled with the app, so a look never asks another host for its type.
const FACES: Record<Exclude<ThemeFont, 'system'>, { family: string; files: ReadonlyArray<readonly [number, string]> }> = {
  roboto: { family: 'Roboto', files: [[300, robotoLight], [400, robotoRegular], [500, robotoMedium], [700, robotoBold]] },
  geist: { family: 'Geist', files: [[200, geistExtraLight], [400, geistRegular], [500, geistMedium], [600, geistSemiBold]] },
};

export async function loadThemeFonts(font: ThemeFont, timeoutMs = 1000): Promise<void> {
  if (font === 'system' || typeof FontFace === 'undefined' || !document.fonts) return;
  const { family, files } = FACES[font];
  const faces = files.map(([weight, url]) => new FontFace(family, `url(${url}) format('woff2')`, {
    weight: String(weight), style: 'normal', display: 'swap',
  }));
  for (const face of faces) document.fonts.add(face);
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.allSettled(faces.map(face => face.load())).then(() => { settled = true; }),
      new Promise(resolve => { timer = setTimeout(resolve, timeoutMs); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
  // Past the deadline the app draws in the fallback and keeps it for this page load: a face that arrived later
  // would swap in with other metrics and move the text.
  if (!settled) for (const face of faces) document.fonts.delete(face);
}
