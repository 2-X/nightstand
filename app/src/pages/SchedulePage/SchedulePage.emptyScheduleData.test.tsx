import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import { server } from '@test/setup';
import SchedulePage from './SchedulePage';

describe('SchedulePage empty schedule data robustness', () => {
  it('shows an error instead of setup controls when /schedules returns an empty object', async () => {
    server.use(
      http.get('*/schedules', () => HttpResponse.json({})),
    );

    renderWithProviders(<SchedulePage />, { initialRoute: '/schedules' });

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the schedule and Pod timezone.');
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Set bedtime and wake time' })).not.toBeInTheDocument();
  });
});
