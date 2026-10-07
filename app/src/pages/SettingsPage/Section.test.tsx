import { expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import Section from './Section';

it('gives section titles a level-two heading larger than body text', () => {
  renderWithProviders(<Section title="Priming">Body</Section>);
  const heading = screen.getByRole('heading', { level: 2, name: 'Priming' });
  expect(heading).toHaveStyle({ fontSize: '1.125rem', fontWeight: 600 });
});
