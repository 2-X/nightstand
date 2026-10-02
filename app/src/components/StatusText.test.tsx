import { expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import StatusText from './StatusText';

it('puts its status region in the page before its text, so a screen reader announces the text', () => {
  expect(renderToStaticMarkup(<StatusText>Loading</StatusText>)).toMatch(/<p[^>]*role="status"[^>]*><\/p>/);
  render(<StatusText>Loading</StatusText>);
  expect(screen.getByRole('status')).toHaveTextContent('Loading');
});
