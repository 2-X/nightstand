import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isValidElement, type ReactNode } from 'react';
import { Navigate, createRoutesFromChildren } from 'react-router-dom';
import AppRoutes from './AppRoutes';
import { SETTINGS_CATEGORIES } from './pages/SettingsPage/settingsCategories';

// The demo deploy copies index.html into a folder per route so deep links answer 200.
// A page added to the app without a folder there would answer the 404 fallback instead.
const workflow = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.github/workflows/deploy-demo.yml');

function deployedRoutes() {
  const loop = readFileSync(workflow, 'utf8').match(/for route in ([^;]+); do/);
  expect(loop, 'the route loop in deploy-demo.yml').not.toBeNull();
  return loop![1].trim().split(/\s+/);
}

// Every path under the layout that shows a page; redirects and the not-found page are left out.
function pageRoutes() {
  const [layout] = createRoutesFromChildren((AppRoutes().props as { children: ReactNode }).children);
  return (layout.children ?? []).flatMap(route => {
    if (route.index || !route.path || route.path === '*') return [];
    if (isValidElement(route.element) && route.element.type === Navigate) return [];
    if (route.path === 'settings/:category') return [...SETTINGS_CATEGORIES.map(({ key }) => key), 'about'].map(key => `settings/${key}`);
    return [route.path];
  });
}

describe('demo deep links', () => {
  it('gives every page route of the app a folder in the demo deploy, and no others', () => {
    expect([...new Set(deployedRoutes())].sort()).toEqual([...new Set(pageRoutes())].sort());
  });
});
