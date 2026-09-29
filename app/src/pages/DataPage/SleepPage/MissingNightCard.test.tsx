import { expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import MissingNightCard from './MissingNightCard';

it('gives a missing-night section the same heading hierarchy as a recorded night', () => {
  renderWithProviders(<MissingNightCard state="empty" canAnalyze={ false } onAnalyze={ () => {} }/>);
  expect(screen.getByRole('heading', { level: 2, name: 'Nothing recorded' }))
    .toHaveStyle({ fontSize: '1.125rem', fontWeight: 600 });
});
