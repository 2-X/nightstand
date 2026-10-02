import { expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '@test/renderWithProviders';
import { server } from '@test/setup';
import { getSchedules } from '../../mocks/mockData';
import UpcomingNight from './UpcomingNight';

it('says the schedule is unavailable instead of dropping the card when schedules fail to load', async () => {
  server.use(http.get('*/api/schedules', () => new HttpResponse(null, { status: 500 })));
  renderWithProviders(<UpcomingNight />);

  expect(await screen.findByText('Schedule unavailable.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
});

it('recovers when Try again succeeds', async () => {
  let fail = true;
  server.use(http.get('*/api/schedules', () => fail
    ? new HttpResponse(null, { status: 500 })
    : HttpResponse.json(getSchedules())));
  const { user } = renderWithProviders(<UpcomingNight />);

  await user.click(await screen.findByRole('button', { name: 'Try again' }));
  fail = false;
  await user.click(await screen.findByRole('button', { name: 'Try again' }));

  await waitFor(() => expect(screen.queryByText('Schedule unavailable.')).not.toBeInTheDocument());
  expect(await screen.findByRole('link', { name: 'Edit schedule' })).toBeInTheDocument();
});

it('holds the card in place with "Loading schedule" while the schedule loads', () => {
  server.use(http.get('*/api/schedules', () => new Promise(() => undefined)));
  renderWithProviders(<UpcomingNight />);
  expect(screen.getByRole('heading', { level: 2, name: 'Tonight' })).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('Loading schedule');
  expect(screen.queryByText('Schedule unavailable.')).not.toBeInTheDocument();
});
