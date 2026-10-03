import { expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import BedVisualization from './BedVisualization';

it('draws the base with no decorative shading or texture, under the same name', () => {
  const { container } = render(<BedVisualization headPosition={ 10 } feetPosition={ 5 }/>);
  expect(screen.getByRole('img', { name: 'Base tilted 10° at the head, 5° at the feet' })).toBeInTheDocument();
  expect(container.querySelector('linearGradient, radialGradient')).toBeNull();
  expect(container.querySelectorAll('line')).toHaveLength(0);
});
