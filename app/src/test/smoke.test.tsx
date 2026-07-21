import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

// Proves the harness environment itself: jsdom renders DOM, Testing Library
// queries it, and the jest-dom matchers registered in setup.ts are active.
describe('harness environment', () => {
  it('renders into jsdom and exposes jest-dom matchers', () => {
    render(<div>harness-smoke</div>);
    expect(screen.getByText('harness-smoke')).toBeInTheDocument();
  });
});
