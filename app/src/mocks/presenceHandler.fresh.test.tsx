import { afterEach, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import { isPresenceFresh, usePresence } from '@api/presence.ts';
import { DEMO_PRESENCE_KEY } from './demoPreferences';

function FreshProbe() {
  const { data } = usePresence();
  return <div>{ data ? isPresenceFresh(data.left) ? 'fresh' : 'stale' : 'loading' }</div>;
}

afterEach(() => localStorage.removeItem(DEMO_PRESENCE_KEY));

it('reports demo presence as fresh unless a spec asks for stale', async () => {
  const view = renderWithProviders(<FreshProbe />);
  expect(await screen.findByText('fresh')).toBeInTheDocument();
  view.unmount();
  localStorage.setItem(DEMO_PRESENCE_KEY, 'stale');
  renderWithProviders(<FreshProbe />);
  expect(await screen.findByText('stale')).toBeInTheDocument();
});
