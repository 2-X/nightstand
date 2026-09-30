import { describe, expect, it } from 'vitest';
import { act, screen } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import { useAppStore } from './appStore.tsx';

function Control() {
  const { isUpdating, setIsUpdating } = useAppStore();
  return (
    <>
      <button disabled={ isUpdating } onClick={ () => setIsUpdating(true) }>Save</button>
      <button>Other</button>
    </>
  );
}

// Browsers drop focus from a control that becomes disabled. jsdom does not,
// and it refuses to blur a disabled element, so the helper re-enables it for
// the instant of the blur.
const saving = async (button: HTMLElement) => {
  await act(async () => undefined);
  expect(button).toBeDisabled();
  act(() => {
    button.toggleAttribute('disabled', false);
    button.blur();
    button.toggleAttribute('disabled', true);
  });
};

describe('focus while a save disables controls', () => {
  it('returns focus to the control that started a keyboard save', async () => {
    const { user } = renderWithProviders(<Control/>);
    const save = screen.getByRole('button', { name: 'Save' });
    await user.tab();
    await user.keyboard('{Enter}');
    await saving(save);
    expect(document.body).toHaveFocus();

    act(() => useAppStore.getState().setIsUpdating(false));

    expect(save).toHaveFocus();
  });

  it('leaves focus alone when the user moved on during the save', async () => {
    const { user } = renderWithProviders(<Control/>);
    const save = screen.getByRole('button', { name: 'Save' });
    await user.tab();
    await user.keyboard('{Enter}');
    await saving(save);
    await user.tab();
    expect(screen.getByRole('button', { name: 'Other' })).toHaveFocus();

    act(() => useAppStore.getState().setIsUpdating(false));

    expect(screen.getByRole('button', { name: 'Other' })).toHaveFocus();
  });

  it('does not take focus back after a click elsewhere during the save', async () => {
    const { user } = renderWithProviders(<Control/>);
    const save = screen.getByRole('button', { name: 'Save' });
    await user.tab();
    await user.keyboard('{Enter}');
    await saving(save);
    await user.pointer({ target: document.body, keys: '[MouseLeft]' });

    act(() => useAppStore.getState().setIsUpdating(false));

    expect(document.body).toHaveFocus();
  });

  it('does not move focus after a save started with the pointer', async () => {
    const { user } = renderWithProviders(<Control/>);
    const save = screen.getByRole('button', { name: 'Save' });
    await user.click(save);
    await saving(save);

    act(() => useAppStore.getState().setIsUpdating(false));

    expect(document.body).toHaveFocus();
  });
});
