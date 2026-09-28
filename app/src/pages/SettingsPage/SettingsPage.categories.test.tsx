import { expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '@test/renderWithProviders';
import { server } from '@test/setup';
import SettingsPage from './SettingsPage';

it('exposes seven named categories without loading every control into the index', async () => {
  renderWithProviders(<SettingsPage/>, { initialRoute: '/settings' });
  for (const name of ['People and sides', 'Bed preferences', 'Automation', 'Sleep data', 'Device', 'Software', 'About']) {
    expect(await screen.findByRole('link', { name: new RegExp(name) })).toBeInTheDocument();
  }
  expect(screen.queryByRole('switch')).not.toBeInTheDocument();
});

it('reports a rejected settings save and lets the user try again', async () => {
  server.use(http.post('*/api/settings', () => new HttpResponse(null, { status: 500 })));
  const { user } = renderWithProviders(<SettingsPage/>, { initialRoute: '/settings/people' });
  const toggle = await screen.findByRole('switch', { name: 'Left away mode' });
  await user.click(toggle);
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not save settings');
  expect(toggle).not.toBeChecked();
  expect(toggle).toBeEnabled();
});

it('keeps software actions on Software and links there from Device', async () => {
  renderWithProviders(<SettingsPage/>, { initialRoute: '/settings/device' });
  expect(await screen.findByRole('link', { name: 'Software and updates' })).toHaveAttribute('href', '/settings/versions');
  expect(screen.queryByRole('button', { name: 'Update' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Roll back|Restore upstream/ })).not.toBeInTheDocument();
});
