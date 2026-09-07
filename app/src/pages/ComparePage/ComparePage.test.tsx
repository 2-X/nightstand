import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import ComparePage from './ComparePage';

describe('ComparePage', () => {
  it('renders one side-pinned pane per side', async () => {
    renderWithProviders(<ComparePage />, { initialRoute: '/compare' });
    const left = await screen.findByTitle(/left/i);
    const right = await screen.findByTitle(/right/i);
    expect(left).toHaveAttribute('src', '/?side=left');
    expect(right).toHaveAttribute('src', '/?side=right');
  });

  it('labels the panes with the configured side names', async () => {
    renderWithProviders(<ComparePage />, { initialRoute: '/compare' });
    // Mock settings name the sides "Left side" / "Right side".
    expect(await screen.findByText('Left side')).toBeInTheDocument();
    expect(await screen.findByText('Right side')).toBeInTheDocument();
  });

  it('offers an exit back to the main app', async () => {
    renderWithProviders(<ComparePage />, { initialRoute: '/compare' });
    expect(await screen.findByLabelText('Exit compare')).toBeInTheDocument();
  });
});
