import { isValidElement, type ReactNode } from 'react';
import { Navigate, createRoutesFromChildren } from 'react-router-dom';
import AppRoutes from '../AppRoutes';
import { SETTINGS_CATEGORIES } from '../pages/SettingsPage/settingsCategories';

// Every path under the layout that shows a page, without a leading slash; redirects and the not-found page are left out.
export function pageRoutes() {
  const [layout] = createRoutesFromChildren((AppRoutes().props as { children: ReactNode }).children);
  return (layout.children ?? []).flatMap(route => {
    if (route.index || !route.path || route.path === '*') return [];
    if (isValidElement(route.element) && route.element.type === Navigate) return [];
    if (route.path === 'settings/:category') return [...SETTINGS_CATEGORIES.map(({ key }) => key), 'about'].map(key => `settings/${key}`);
    return [route.path];
  });
}
