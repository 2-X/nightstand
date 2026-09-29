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
  const names = await screen.findAllByRole('textbox', { name: 'Side name' });
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
  const name = screen.getByRole('textbox', { name: 'Side name' });
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
  const name = screen.getByRole('textbox', { name: 'Side name' });
  const disabled = name.hasAttribute('disabled');
  act(() => useAppStore.setState({ isUpdating: false }));
  expect(disabled).toBe(false);
  await user.clear(name);
  await user.type(name, 'Jamie');
  expect(name).toHaveValue('Jamie');
});
