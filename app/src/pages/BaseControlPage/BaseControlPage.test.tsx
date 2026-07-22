import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import BaseControlPage from './BaseControlPage';

describe('BaseControlPage', () => {
  it('renders the elevation control with its presets', async () => {
    renderWithProviders(<BaseControlPage />, { initialRoute: '/elevation' });
    expect(await screen.findByText('Elevation')).toBeInTheDocument();
    expect(await screen.findByText('Flat')).toBeInTheDocument();
  });
});
