import { THEMES } from './themes';
import { DEFAULT_THEME_ID, THEME_IDS, THEME_STORAGE_KEY } from './themes/ids';

// Runs in the page head before the first paint: the stored look, or the default, and its background.
export function themeBootScript(): string {
  const backgrounds = Object.fromEntries(THEME_IDS.map(id => [id, THEMES[id].palette.bg.base]));
  return [
    '(function () {',
    `var key = ${JSON.stringify(THEME_STORAGE_KEY)}, backgrounds = ${JSON.stringify(backgrounds)};`,
    `var theme = ${JSON.stringify(DEFAULT_THEME_ID)};`,
    'try {',
    '  var stored = window.localStorage.getItem(key);',
    '  if (stored && Object.prototype.hasOwnProperty.call(backgrounds, stored)) theme = stored;',
    '} catch (error) {}',
    'var root = document.documentElement;',
    `root.setAttribute('data-theme', theme);`,
    'root.style.backgroundColor = backgrounds[theme];',
    `root.style.colorScheme = 'dark';`,
    `document.querySelectorAll('meta[name="theme-color"], meta[name="msapplication-TileColor"]').forEach(function (meta) {`,
    `  meta.setAttribute('content', backgrounds[theme]);`,
    '});',
    '})();',
  ].join('\n');
}
