import { beforeEach, expect, it } from 'vitest';
import { http } from 'msw';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import { server } from '@test/setup';
import { useAppStore } from '@state/appStore.tsx';
import ControlTempPage from './ControlTempPage';
import { useControlTempStore } from './controlTempStore';

beforeEach(() => {
  useAppStore.setState({ side: 'left', isUpdating: false });
  useControlTempStore.setState({ commandError: undefined, deviceStatus: undefined, pendingEdits: 0 });
});

it('draws every slot, empty, while the bed status loads', async () => {
  server.use(http.get('*/api/deviceStatus', () => new Promise(() => undefined)));
  const { container } = renderWithProviders(<ControlTempPage/>);
  expect(await screen.findByRole('radio', { name: 'Alex.' })).toBeChecked();
  expect(within(container.querySelector('[data-dial]') as HTMLElement).getByRole('status')).toHaveTextContent('Loading');
  expect(container.querySelector('[data-caption-slot]')!.textContent).toBe('');
  expect(container.querySelector('[data-controls-row]')).toBeEmptyDOMElement();
  expect(container.querySelector('[data-power-row]')).toBeEmptyDOMElement();
  expect(screen.queryByRole('button', { name: /^Turn o/ })).not.toBeInTheDocument();
  expect(container.querySelector('[data-last-night-chip]')).toBeNull();
});
