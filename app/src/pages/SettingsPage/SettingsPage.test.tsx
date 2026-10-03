import { describe, it, expect, vi } from 'vitest';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@test/setup';
import { renderWithProviders, renderApp } from '@test/renderWithProviders';
import SettingsPage from './SettingsPage';

describe('SettingsPage', () => {
  it('renders the settings page', async () => {
    renderWithProviders(<SettingsPage />, { initialRoute: '/settings' });
    expect(await screen.findByRole('link', { name: /Bed and sides/ })).toBeInTheDocument();
  });

  // The Versions page is only reachable from here, so a silently dropped row
  // strands the version picker and instant rollback at a URL nobody types.
  it('navigates to the versions page from the Versions row', async () => {
    const { user } = renderApp('/settings');
    await act(() => vi.dynamicImportSettled());

    await user.click(await screen.findByRole('link', { name: /Software/ }));
    await act(() => vi.dynamicImportSettled());

    expect(await screen.findByText('Software')).toBeInTheDocument();
  });

  it('locks every bed setting while the settings have not loaded', async () => {
    let posts = 0;
    server.use(
      http.get('*/settings', () => new HttpResponse(null, { status: 500 })),
      http.post('*/settings', () => { posts += 1; return HttpResponse.json({}); }),
    );
    renderWithProviders(<SettingsPage/>, { initialRoute: '/settings/bed' });
    expect(await screen.findByText('Could not load settings.')).toBeVisible();
    const user = userEvent.setup({ pointerEventsCheck: 0 });

    const switches = screen.getAllByRole('switch');
    expect(switches.length).toBeGreaterThanOrEqual(4);
    for (const control of switches) {
      expect(control).toBeDisabled();
      expect(control).not.toBeChecked();
      await user.click(control);
    }

    for (const name of ['Left side name', 'Right side name']) {
      expect(screen.getByRole('textbox', { name })).toHaveValue('');
    }

    const time = screen.getByLabelText('Prime time');
    expect(time).toBeDisabled();
    expect(time).toHaveValue('');

    for (const name of ['Fahrenheit', 'Celsius']) {
      const button = screen.getByRole('button', { name });
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute('aria-pressed', 'false');
      await user.click(button);
    }

    const zone = screen.getByRole('combobox', { name: 'Time zone' });
    expect(zone).toHaveAttribute('aria-disabled', 'true');
    await user.click(zone);
    expect(screen.queryByRole('option')).not.toBeInTheDocument();

    expect(posts).toBe(0);
  });
});
