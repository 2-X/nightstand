import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { themeBootScript } from './themeBoot';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// Vite's bundler cannot start inside jsdom, so the page is transformed in a plain Node process.
const TRANSFORM = `
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';
const server = await createServer({
  configFile: 'vite.config.ts', logLevel: 'silent', appType: 'custom', cacheDir: process.env.VITE_CACHE_DIR,
  server: { middlewareMode: true, hmr: false, ws: false },
});
process.stdout.write(await server.transformIndexHtml('/', readFileSync('index.html', 'utf8')));
await server.close();
`;

// Last in <head>, so the meta tags it recolours already exist when it runs.
it('injects the boot script as the last element of the page head', () => {
  // A throwaway cache, so the dependency scan leaves nothing behind in node_modules/.vite.
  const cacheDir = mkdtempSync(path.join(tmpdir(), 'nightstand-vite-'));
  let html: string;
  try {
    html = execFileSync(process.execPath, ['--input-type=module', '-e', TRANSFORM], {
      cwd: appRoot, encoding: 'utf8', env: { ...process.env, VITE_CACHE_DIR: cacheDir },
    });
  } finally {
    rmSync(cacheDir, { recursive: true, force: true });
  }
  const head = html.slice(0, html.indexOf('</head>')).trimEnd();
  expect(head.endsWith(`<script>${themeBootScript()}</script>`)).toBe(true);
});
