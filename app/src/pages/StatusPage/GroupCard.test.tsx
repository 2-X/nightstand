import { expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import { getServerStatus } from '../../mocks/mockData';
import { Status } from '@api/serverStatusSchema';
import GroupCard from './GroupCard';
import { CORE_KEYS } from './statusMeta';

it('counts every service state in its collapsed summary', () => {
  const data = { ...getServerStatus() };
  const states: Status[] = ['healthy', 'not_started', 'started', 'waiting_for_data', 'retrying', 'restarting', 'failed'];
  CORE_KEYS.forEach((key, index) => { data[key] = { ...data[key]!, status: states[index] ?? 'healthy' }; });
  renderWithProviders(<GroupCard label="Core services" keys={ CORE_KEYS } data={ data }/>);
  expect(screen.getByRole('button', {
    name: 'Core services · 4 healthy, 1 starting, 1 running, 1 waiting for data, 1 retrying, 1 restarting, 1 failed',
  })).toBeVisible();
});

it('puts each group under an h2 so the page outline does not skip a level', () => {
  renderWithProviders(<GroupCard label="Core services" keys={ CORE_KEYS } data={ getServerStatus() }/>);
  const heading = screen.getByRole('heading', { level: 2 });
  expect(heading).toContainElement(screen.getByRole('button', { name: /^Core services/ }));
});
