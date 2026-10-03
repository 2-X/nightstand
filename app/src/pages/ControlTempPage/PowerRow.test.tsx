/* eslint-disable react/no-multi-comp */ // Small wrappers drive the row from stale to answering.
import { beforeEach, expect, it, vi } from 'vitest';
import { useState, type ReactNode } from 'react';
import { act, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '@test/renderWithProviders';
import { server } from '@test/setup';
import { useAppStore } from '@state/appStore.tsx';
import { palette } from '@design/tokens';
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
  expect(turnOn).toHaveStyle({ backgroundColor: '#000000', color: '#90CAF9', width: '100%', minHeight: '54px' });
  expect(turnOn).toHaveStyle({ boxShadow: 'inset 0 0 0 1.5px rgba(144,202,249,0.7)' });
  unmount();
  renderWithProviders(<PowerRow isOn refetch={ refetch }/>);
  const turnOff = await screen.findByRole('button', { name: 'Turn off' });
  expect(turnOff).toHaveStyle({ backgroundColor: '#000000', width: '100%', minHeight: '54px' });
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
  expect(button).toHaveStyle({ backgroundColor: '#000000', color: '#90CAF9', width: '100%' });
  expect(screen.queryByRole('button', { name: 'Turn off' })).not.toBeInTheDocument();
  await user.click(button);
  expect(retry).toHaveBeenCalledOnce();
});

it('greys Try again while a change saves, and keeps it focusable', async () => {
  useAppStore.setState({ isUpdating: true });
  renderWithProviders(<PowerRow isOn refetch={ refetch } onRetry={ vi.fn() }/>);
  const button = await screen.findByRole('button', { name: 'Try again' });
  expect(button).not.toBeDisabled();
  expect(button).toHaveAttribute('aria-disabled', 'true');
  // The steppers' disabled ring.
  expect(button).toHaveStyle({ color: palette.text.disabled, boxShadow: `inset 0 0 0 1.5px ${palette.step.disabled.toLowerCase()}` });
});

it('keeps focus on the button when Turn off and Try again trade places', async () => {
  let setStale: (stale: boolean) => void = () => {};
  function Row() {
    const [stale, set] = useState(false);
    setStale = set;
    return <PowerRow isOn refetch={ refetch } onRetry={ stale ? () => {} : undefined }/>;
  }
  renderWithProviders(<Row/>);
  (await screen.findByRole('button', { name: 'Turn off' })).focus();
  act(() => setStale(true));
  expect(screen.getByRole('button', { name: 'Try again' })).toHaveFocus();
  act(() => setStale(false));
  expect(screen.getByRole('button', { name: 'Turn off' })).toHaveFocus();
});

// A row for an away side that starts stale; the returned function says whether the Pod answers.
const renderStaleAwayRow = (before?: ReactNode) => {
  const settings = getSettings();
  server.use(http.get('*/api/settings', () => HttpResponse.json({ ...settings, left: { ...settings.left, awayMode: true } })));
  let setStale: (stale: boolean) => void = () => {};
  function Row() {
    const [stale, set] = useState(true);
    setStale = set;
    return <PowerRow isOn refetch={ refetch } onRetry={ stale ? () => {} : undefined }/>;
  }
  renderWithProviders(<>{ before }<Row/></>);
  return (stale: boolean) => act(() => setStale(stale));
};

it('keeps focus in the row when Try again and the away sentence trade places', async () => {
  const setStale = renderStaleAwayRow();
  (await screen.findByRole('button', { name: 'Try again' })).focus();
  setStale(false);
  expect(await screen.findByRole('link', { name: 'Settings, Bed and sides' })).toHaveFocus();
  setStale(true);
  expect(screen.getByRole('button', { name: 'Try again' })).toHaveFocus();
});

it('leaves focus alone when it was not on Try again', async () => {
  const setStale = renderStaleAwayRow(<button>Elsewhere</button>);
  await screen.findByRole('button', { name: 'Try again' });
  screen.getByRole('button', { name: 'Elsewhere' }).focus();
  setStale(false);
  expect(await screen.findByRole('link', { name: 'Settings, Bed and sides' })).not.toHaveFocus();
  expect(screen.getByRole('button', { name: 'Elsewhere' })).toHaveFocus();
});

it('stays empty at its full height while the status loads', async () => {
  const { container } = renderWithProviders(<PowerRow isOn={ false } loading refetch={ refetch }/>);
  const row = container.querySelector('[data-power-row]')!;
  expect(row).toBeEmptyDOMElement();
  expect(row).toHaveStyle({ minHeight: '54px' });
});
