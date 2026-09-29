import { expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import BedTabs from './BedTabs';

it('exposes bed destinations as links without orphan tab semantics', async () => {
  renderWithProviders(<BedTabs/>, { initialRoute: '/elevation' });
  const navigation = await screen.findByRole('navigation', { name: 'Bed controls' });
  expect(await within(navigation).findByRole('link', { name: 'Elevation' })).toHaveAttribute('aria-current', 'page');
  expect(within(navigation).getByRole('link', { name: 'Temperature' })).toHaveAttribute('href', '/');
  expect(screen.queryByRole('tab')).not.toBeInTheDocument();
});


it('selects Temperature at its named route', async () => {
  renderWithProviders(<BedTabs/>, { initialRoute: '/temperature' });
  expect(await screen.findByRole('link', { name: 'Temperature' })).toHaveAttribute('aria-current', 'page');
  expect(screen.getByRole('link', { name: 'Elevation' })).not.toHaveAttribute('aria-current');
});
