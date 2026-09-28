import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderApp } from './renderWithProviders';

describe('renderApp', () => {
  it('renders the real route tree at a given path', async () => {
    renderApp('/status');
    expect(await screen.findByRole('heading', { name: 'System' })).toBeInTheDocument();
  });
});
