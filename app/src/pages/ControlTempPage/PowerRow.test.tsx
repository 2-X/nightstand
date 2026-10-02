import { beforeEach, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '@test/renderWithProviders';
import { server } from '@test/setup';
import { useAppStore } from '@state/appStore.tsx';
import { getSettings } from '../../mocks/mockData';
import PowerRow from './PowerRow';

const refetch = () => Promise.resolve({ data: undefined });
beforeEach(() => {
  useAppStore.setState({ side: 'left', isUpdating: false });
});

it('points to where away mode is changed instead of leaving a blank gap', async () => {
  const settings = getSettings();
  server.use(http.get('*/api/settings', () => HttpResponse.json({ ...settings, left: { ...settings.left, awayMode: true } })));
  renderWithProviders(<PowerRow isOn={ false } refetch={ refetch }/>);
  const link = await screen.findByRole('link', { name: 'Settings, Bed and sides' });
  expect(link).toHaveAttribute('href', '/settings/bed');
  expect(link.closest('[data-power-row]')).not.toBeNull();
  expect(screen.queryByRole('button', { name: /Turn o/ })).not.toBeInTheDocument();
});

it('draws Turn on and Turn off as matching full width dark pills', async () => {
  const { unmount } = renderWithProviders(<PowerRow isOn={ false } refetch={ refetch }/>);
  const turnOn = await screen.findByRole('button', { name: 'Turn on' });
  expect(turnOn).toHaveStyle({ backgroundColor: '#1C1915', color: '#E9E3D5', width: '100%', minHeight: '54px' });
  expect(turnOn).toHaveStyle({ boxShadow: 'inset 0 0 0 1.5px rgba(233,227,213,0.7)' });
  unmount();
  renderWithProviders(<PowerRow isOn refetch={ refetch }/>);
  const turnOff = await screen.findByRole('button', { name: 'Turn off' });
  expect(turnOff).toHaveStyle({ backgroundColor: '#2A251F', width: '100%', minHeight: '54px' });
});

it('holds the button in a row of fixed height', async () => {
  renderWithProviders(<PowerRow isOn refetch={ refetch }/>);
  const power = await screen.findByRole('button', { name: 'Turn off' });
  expect(power.closest('[data-power-row]')).toHaveStyle({ minHeight: '54px' });
});

it('keeps the power control focusable while a change saves', async () => {
  useAppStore.setState({ isUpdating: true });
  renderWithProviders(<PowerRow isOn refetch={ refetch }/>);
  const power = await screen.findByRole('button', { name: 'Turn off' });
  expect(power).not.toBeDisabled();
  expect(power).toHaveAttribute('aria-disabled', 'true');
});

it('puts Try again in the calm pill while the Pod does not answer', async () => {
  const retry = vi.fn();
  const { user } = renderWithProviders(<PowerRow isOn refetch={ refetch } onRetry={ retry }/>);
  const button = await screen.findByRole('button', { name: 'Try again' });
  expect(button).toHaveStyle({ backgroundColor: '#1C1915', color: '#E9E3D5', width: '100%' });
  expect(screen.queryByRole('button', { name: 'Turn off' })).not.toBeInTheDocument();
  await user.click(button);
  expect(retry).toHaveBeenCalledOnce();
});

it('stays empty at its full height while the status loads', async () => {
  const { container } = renderWithProviders(<PowerRow isOn={ false } loading refetch={ refetch }/>);
  const row = container.querySelector('[data-power-row]')!;
  expect(row).toBeEmptyDOMElement();
  expect(row).toHaveStyle({ minHeight: '54px' });
});
