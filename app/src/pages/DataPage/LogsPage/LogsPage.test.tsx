import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import LogsPage from './LogsPage';

// jsdom doesn't implement scrollIntoView; LogsPage calls it on every log
// update to autoscroll, so stub it out for this render.
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView || (() => {});

describe('LogsPage', () => {
  it('renders the live server logs page', async () => {
    renderWithProviders(<LogsPage />, { initialRoute: '/data/logs' });
    expect(await screen.findByText('Live Server Logs')).toBeInTheDocument();
  });
});
