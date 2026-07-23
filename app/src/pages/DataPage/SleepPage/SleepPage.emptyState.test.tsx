import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import { server } from '@test/setup';
import SleepPage from './SleepPage';

describe('SleepPage empty records robustness', () => {
  it('shows an empty state instead of crashing when there are no sleep records', async () => {
    server.use(
      http.get('*/metrics/sleep', () => HttpResponse.json([])),
    );

    renderWithProviders(<SleepPage />, { initialRoute: '/data/sleep' });

    await screen.findByText('Sleep');
    expect(await screen.findByText('No data available for the selected time range')).toBeInTheDocument();
  });
});
