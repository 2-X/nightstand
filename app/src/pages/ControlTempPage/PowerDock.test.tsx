import { beforeEach, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '@test/renderWithProviders';
import { server } from '@test/setup';
import { useAppStore } from '@state/appStore.tsx';
import { getSettings } from '../../mocks/mockData';
import PowerDock from './PowerDock';

vi.mock('./DockCaption', () => ({
  default: ({ isOn }: { isOn: boolean }) => <div data-dock-caption>{ isOn ? 'Turns off' : 'Turns on' }</div>,
  dockSlotSx: {},
}));

const refetch = () => Promise.resolve({ data: undefined });
beforeEach(() => {
  useAppStore.setState({ side: 'left', isUpdating: false });
});

it('points to where away mode is changed instead of leaving a blank gap', async () => {
  const settings = getSettings();
  server.use(http.get('*/api/settings', () => HttpResponse.json({ ...settings, left: { ...settings.left, awayMode: true } })));
  renderWithProviders(<PowerDock isOn={ false } refetch={ refetch }/>);
  const link = await screen.findByRole('link', { name: 'Settings, Bed and sides' });
  expect(link).toHaveAttribute('href', '/settings/bed');
  expect(screen.queryByRole('button', { name: /Turn o/ })).not.toBeInTheDocument();
});

it('shows the caption beside the power control', async () => {
  renderWithProviders(<PowerDock isOn refetch={ refetch }/>);
  const power = await screen.findByRole('button', { name: 'Turn off' });
  expect(screen.getByText('Turns off').closest('[data-power-dock]')).toBe(power.closest('[data-power-dock]'));
});

it('draws Turn on and Turn off as matching dark pills of one size', async () => {
  const { unmount } = renderWithProviders(<PowerDock isOn={ false } refetch={ refetch }/>);
  const turnOn = await screen.findByRole('button', { name: 'Turn on' });
  expect(turnOn).toHaveStyle({ backgroundColor: '#1C1915', color: '#E9E3D5', minWidth: '124px', minHeight: '54px' });
  expect(turnOn).toHaveStyle({ boxShadow: 'inset 0 0 0 1.5px rgba(233,227,213,0.7)' });
  unmount();
  renderWithProviders(<PowerDock isOn refetch={ refetch }/>);
  const turnOff = await screen.findByRole('button', { name: 'Turn off' });
  expect(turnOff).toHaveStyle({ backgroundColor: '#2A251F', minWidth: '124px', minHeight: '54px' });
});

it('keeps the power control focusable while a change saves', async () => {
  useAppStore.setState({ isUpdating: true });
  renderWithProviders(<PowerDock isOn refetch={ refetch }/>);
  const power = await screen.findByRole('button', { name: 'Turn off' });
  expect(power).not.toBeDisabled();
  expect(power).toHaveAttribute('aria-disabled', 'true');
});
