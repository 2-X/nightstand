import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderApp } from './renderWithProviders';

describe('renderApp', () => {
  it('renders the real route tree at a given path', async () => {
    renderApp('/status');
    // StatusPage has no heading role; once it and the mocked serverStatus
    // data resolve, the all-healthy summary line is a stable rendered marker.
    expect(await screen.findByText(/everything is running normally/i)).toBeInTheDocument();
  });
});
