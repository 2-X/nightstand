import { expect, it, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '@test/renderWithProviders';
import { server } from '@test/setup';
import { getSettings } from '../../mocks/mockData';
import SettingsPage from './SettingsPage';
import { useAppStore } from '@state/appStore';
import SideSettings from './SideSettings';

it('keeps the other name editable and preserves its draft while a save completes', async () => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const settings = structuredClone(getSettings());
  server.use(http.get('*/settings', () => HttpResponse.json(settings)),
    http.post('*/settings', async ({ request }) => {
      const patch = await request.json() as { left?: { name: string } };
      await pending;
      if (patch.left) settings.left.name = patch.left.name;
      return HttpResponse.json(settings);
    }));
  const { user } = renderWithProviders(<SettingsPage/>, { initialRoute: '/settings/bed' });
  const names = [
    await screen.findByRole('textbox', { name: 'Left side name' }),
    await screen.findByRole('textbox', { name: 'Right side name' }),
  ];
  await waitFor(() => expect(names[0]).toHaveValue(settings.left.name));
  await user.clear(names[0]);
  await user.type(names[0], 'Alex');
  await user.click(names[1]);
  const editable = !names[1].hasAttribute('disabled');
  if (editable) { await user.clear(names[1]); await user.type(names[1], 'Jamie'); }
  release();
  await waitFor(() => expect(names[0]).toBeEnabled());
  expect(names[0]).toHaveValue('Alex');
  expect(editable).toBe(true);
  expect(names[1]).toHaveValue('Jamie');
});

it('shows a validation error for a whitespace-only name without saving it', async () => {
  const updateSettings = vi.fn();
  const { user } = renderWithProviders(<SideSettings side="left" settings={ getSettings() } updateSettings={ updateSettings }/>);
  const name = screen.getByRole('textbox', { name: 'Left side name' });
  await user.clear(name);
  await user.type(name, '   ');
  await user.tab();
  expect(await screen.findByText('Enter a side name.')).toBeVisible();
  expect(name).toHaveAttribute('aria-invalid', 'true');
  expect(updateSettings).not.toHaveBeenCalled();
});


it('allows editing a name while another setting is saving', async () => {
  const { user } = renderWithProviders(<SideSettings side="right" settings={ getSettings() } updateSettings={ vi.fn() }/>);
  act(() => useAppStore.setState({ isUpdating: true }));
  const name = screen.getByRole('textbox', { name: 'Right side name' });
  const disabled = name.hasAttribute('disabled');
  act(() => useAppStore.setState({ isUpdating: false }));
  expect(disabled).toBe(false);
  await user.clear(name);
  await user.type(name, 'Jamie');
  expect(name).toHaveValue('Jamie');
});

it('saves the name when Enter is pressed and keeps focus in the field', async () => {
  const updateSettings = vi.fn().mockResolvedValue(undefined);
  const { user } = renderWithProviders(<SideSettings side="left" settings={ getSettings() } updateSettings={ updateSettings }/>);
  const name = screen.getByRole('textbox', { name: 'Left side name' });
  await user.clear(name);
  await user.type(name, 'Jordan{Enter}');
  await waitFor(() => expect(updateSettings).toHaveBeenCalledWith({ left: { name: 'Jordan' } }));
  expect(name).toHaveFocus();
  await user.tab();
  expect(updateSettings).toHaveBeenCalledTimes(1);
});

it('drops control and override characters but keeps left and right marks', async () => {
  const { user } = renderWithProviders(<SideSettings side="left" settings={ getSettings() } updateSettings={ vi.fn() }/>);
  const name = screen.getByRole('textbox', { name: 'Left side name' });
  await user.clear(name);
  await user.click(name);
  await user.paste('Al\u0000ex\u202Eev\u200E\u200F');
  expect(name).toHaveValue('Alexev\u200E\u200F');
});

it('refuses extra typing at the limit instead of cutting the end of the name', async () => {
  const { user } = renderWithProviders(<SideSettings side="left" settings={ getSettings() } updateSettings={ vi.fn() }/>);
  const name = screen.getByRole('textbox', { name: 'Left side name' });
  await user.clear(name);
  await user.type(name, 'abcdefghijklmnopqrst');
  await user.type(name, 'XY');
  expect(name).toHaveValue('abcdefghijklmnopqrst');
  await user.keyboard('{Home}Z');
  expect(name).toHaveValue('abcdefghijklmnopqrst');
});

it('trims a long paste by whole characters, never through an emoji', async () => {
  const { user } = renderWithProviders(<SideSettings side="left" settings={ getSettings() } updateSettings={ vi.fn() }/>);
  const name = screen.getByRole('textbox', { name: 'Left side name' });
  await user.clear(name);
  await user.click(name);
  await user.paste('a'.repeat(19) + '\u{1F600}');
  expect(name).toHaveValue('a'.repeat(19));
  await user.clear(name);
  await user.paste('a'.repeat(17) + '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}');
  expect(name).toHaveValue('a'.repeat(17));
});

it('sends the same name again on Enter after a failed save', async () => {
  const updateSettings = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
  const { user } = renderWithProviders(<SideSettings side="left" settings={ getSettings() } updateSettings={ updateSettings }/>);
  const name = screen.getByRole('textbox', { name: 'Left side name' });
  await user.clear(name);
  await user.type(name, 'Riley{Enter}');
  await waitFor(() => expect(name).not.toHaveAttribute('readonly'));
  await user.type(name, '{Enter}');
  await waitFor(() => expect(updateSettings).toHaveBeenCalledTimes(2));
  expect(updateSettings).toHaveBeenLastCalledWith({ left: { name: 'Riley' } });
});

it('retries a name the page failed to save', async () => {
  let posts = 0;
  server.use(http.post('*/settings', () => {
    posts += 1;
    return new HttpResponse(null, { status: 500 });
  }));
  const { user } = renderWithProviders(<SettingsPage/>, { initialRoute: '/settings/bed' });
  const name = await screen.findByRole('textbox', { name: 'Left side name' });
  await waitFor(() => expect(name).toBeEnabled());
  await user.clear(name);
  await user.type(name, 'Riley{Enter}');
  await waitFor(() => expect(posts).toBe(1));
  await screen.findByText(/Could not save settings/);
  await waitFor(() => expect(name).not.toHaveAttribute('readonly'));
  await user.type(name, '{Enter}');
  await waitFor(() => expect(posts).toBe(2));
});
