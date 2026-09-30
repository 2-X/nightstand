import { expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '@test/renderWithProviders';
import { server } from '@test/setup';
import { useAppStore } from '@state/appStore.tsx';
import { getSettings } from '../../mocks/mockData';
import PowerButton from './PowerButton';

it('points to where away mode is changed instead of leaving a blank gap', async () => {
  useAppStore.setState({ side: 'left' });
  const settings = getSettings();
  server.use(http.get('*/api/settings', () => HttpResponse.json({ ...settings, left: { ...settings.left, awayMode: true } })));
  renderWithProviders(<PowerButton isOn={ false } refetch={ () => Promise.resolve({ data: undefined }) }/>);

  const link = await screen.findByRole('link', { name: 'Settings, Bed and sides' });
  expect(link).toHaveAttribute('href', '/settings/bed');
  expect(screen.queryByRole('button', { name: /Turn o/ })).not.toBeInTheDocument();
});
