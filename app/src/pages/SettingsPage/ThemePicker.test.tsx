import { afterEach, beforeEach, expect, expectTypeOf, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import { DEFAULT_THEME_ID, THEME_IDS, THEME_STORAGE_KEY } from '@design/themes/ids';
import { THEME_NAMES, THEME_PICKER_COPY } from '@design/themes/copy';
import { themeBootScript } from '@design/themeBoot';
import { activeThemeId, readStoredThemeId, saveThemeId } from '@design/themePreference';
import ThemePicker from './ThemePicker';

const other = THEME_IDS.find(id => id !== DEFAULT_THEME_ID)!;

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

it('offers every look as a radio in one labelled group, with the current one chosen', () => {
  renderWithProviders(<ThemePicker reload={ vi.fn() }/>);
  const group = screen.getByRole('radiogroup', { name: THEME_PICKER_COPY.label });
  expect(within(group).getAllByRole('radio').map(radio => radio.getAttribute('value'))).toEqual([...THEME_IDS]);
  for (const id of THEME_IDS) expect(within(group).getByRole('radio', { name: THEME_NAMES[id] })).toBeInTheDocument();
  expect(within(group).getByRole('radio', { name: THEME_NAMES[DEFAULT_THEME_ID] })).toBeChecked();
});

it('boots lamp for a removed stored id and offers only the three supported looks to save', async () => {
  localStorage.setItem(THEME_STORAGE_KEY, 'nightstand');
  const root = document.documentElement;
  const previousTheme = root.getAttribute('data-theme');
  const previousStyle = root.getAttribute('style');
  try {
    new Function(themeBootScript())();
    expect(root.dataset.theme).toBe('lamp');
    expect(readStoredThemeId()).toBe('lamp');
    expect(activeThemeId()).toBe('lamp');
    expectTypeOf(saveThemeId).parameter(0).toEqualTypeOf<'lamp' | 'classic' | 'glass'>();
    const reload = vi.fn();
    const { user } = renderWithProviders(<ThemePicker reload={ reload }/>);
    const group = screen.getByRole('radiogroup', { name: THEME_PICKER_COPY.label });
    expect(within(group).getAllByRole('radio').map(radio => radio.getAttribute('value')))
      .toEqual(['lamp', 'classic', 'glass']);
    expect(within(group).getByRole('radio', { name: 'lamp' })).toBeChecked();
    await user.click(within(group).getByRole('radio', { name: 'free-sleep classic' }));
    await user.click(screen.getByRole('button', { name: THEME_PICKER_COPY.apply }));
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('classic');
    expect(reload).toHaveBeenCalledOnce();
  } finally {
    if (previousTheme === null) root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', previousTheme);
    if (previousStyle === null) root.removeAttribute('style');
    else root.setAttribute('style', previousStyle);
  }
});

it('gives every choice a row at least 44 px tall', () => {
  renderWithProviders(<ThemePicker reload={ vi.fn() }/>);
  for (const radio of screen.getAllByRole('radio')) expect(radio.closest('label')).toHaveStyle({ minHeight: '44px' });
});

it('moves the choice with the arrow keys without saving or reloading', async () => {
  const reload = vi.fn();
  const { user } = renderWithProviders(<ThemePicker reload={ reload }/>);
  const current = screen.getByRole('radio', { name: THEME_NAMES[DEFAULT_THEME_ID] });
  current.focus();
  await user.keyboard('{ArrowDown}');
  const next = THEME_IDS[(THEME_IDS.indexOf(DEFAULT_THEME_ID) + 1) % THEME_IDS.length];
  expect(screen.getByRole('radio', { name: THEME_NAMES[next] })).toBeChecked();
  expect(current).not.toBeChecked();
  expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  expect(reload).not.toHaveBeenCalled();
});

it('keeps the apply button in place but disabled while the current look is chosen', async () => {
  const reload = vi.fn();
  const { user } = renderWithProviders(<ThemePicker reload={ reload }/>);
  const button = screen.getByRole('button', { name: THEME_PICKER_COPY.apply });
  expect(button).toHaveAttribute('aria-disabled', 'true');
  expect(button).toHaveStyle({ minHeight: '44px' });
  expect(screen.getByText(THEME_PICKER_COPY.applyNote)).toBeInTheDocument();
  await user.click(button);
  expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  expect(reload).not.toHaveBeenCalled();
  await user.click(screen.getByRole('radio', { name: THEME_NAMES[other] }));
  expect(button).not.toHaveAttribute('aria-disabled');
});

it('saves the chosen look on this device and reloads into it once applied', async () => {
  const reload = vi.fn();
  const { user } = renderWithProviders(<ThemePicker reload={ reload }/>);
  await user.click(screen.getByRole('radio', { name: THEME_NAMES[other] }));
  expect(reload).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: THEME_PICKER_COPY.apply }));
  expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe(other);
  expect(reload).toHaveBeenCalledOnce();
});

it('says so in its own slot and keeps the current look when this device will not save it', async () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
  const reload = vi.fn();
  const { user } = renderWithProviders(<ThemePicker reload={ reload }/>);
  const slot = screen.getByRole('alert');
  expect(slot).toBeEmptyDOMElement();
  await user.click(screen.getByRole('radio', { name: THEME_NAMES[other] }));
  await user.click(screen.getByRole('button', { name: THEME_PICKER_COPY.apply }));
  expect(screen.getByRole('alert')).toBe(slot);
  expect(slot).toHaveTextContent(THEME_PICKER_COPY.saveFailed);
  expect(reload).not.toHaveBeenCalled();
  await user.click(screen.getByRole('radio', { name: THEME_NAMES[DEFAULT_THEME_ID] }));
  expect(slot).toBeEmptyDOMElement();
});

it('credits the projects the looks come from', () => {
  renderWithProviders(<ThemePicker reload={ vi.fn() }/>);
  expect(screen.getByText(THEME_PICKER_COPY.helper)).toBeInTheDocument();
});

it('hides the swatches from assistive tech', () => {
  const { container } = renderWithProviders(<ThemePicker reload={ vi.fn() }/>);
  const swatches = container.querySelectorAll('[data-theme-preview]');
  expect(swatches).toHaveLength(THEME_IDS.length);
  for (const swatch of swatches) expect(swatch).toHaveAttribute('aria-hidden', 'true');
});
