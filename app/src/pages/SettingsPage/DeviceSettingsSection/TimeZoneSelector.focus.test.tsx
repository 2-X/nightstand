import { expect, it } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import { getSettings } from '../../../mocks/mockData';
import { useAppStore } from '@state/appStore.tsx';
import TimeZoneSelector from './TimeZoneSelector';

it('returns focus to the picker, not the vanished menu option, after a keyboard choice saves', async () => {
  const settings = { ...getSettings(), timeZone: 'America/Los_Angeles' as const };
  const { user } = renderWithProviders(
    <TimeZoneSelector settings={ settings } updateSettings={ () => useAppStore.getState().setIsUpdating(true) }/>,
  );
  const picker = screen.getByRole('combobox');
  await user.tab();
  expect(picker).toHaveFocus();
  await user.keyboard('{Enter}');
  const [option] = await screen.findAllByRole('option', { name: /Eastern/ });
  option.focus();
  await user.keyboard('{Enter}');
  await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
  expect(useAppStore.getState().isUpdating).toBe(true);

  // A browser drops focus from the picker once it is disabled; jsdom will not blur a disabled element.
  act(() => {
    picker.removeAttribute('aria-disabled');
    picker.blur();
  });
  act(() => useAppStore.getState().setIsUpdating(false));

  await waitFor(() => expect(picker).toHaveFocus());
});
