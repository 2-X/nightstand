import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import { server } from '@test/setup';
import SchedulePage from './SchedulePage';

describe('SchedulePage empty schedule data robustness', () => {
  it('renders without throwing when /schedules returns an empty object', async () => {
    server.use(
      http.get('*/schedules', () => HttpResponse.json({})),
    );

    renderWithProviders(<SchedulePage />, { initialRoute: '/schedules' });

    // The day tabs (static UI) render regardless of data shape; this proves
    // the page survived the render + effect pass without an unhandled throw.
    expect(await screen.findByText('Power on')).toBeInTheDocument();
    expect(await screen.findAllByRole('tab')).toHaveLength(7);
  });
});
