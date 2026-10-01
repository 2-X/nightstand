import { expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import LevelStepper from './LevelStepper';

it('steps whole levels, shows the chosen unit and stops at the ends', () => {
  const onChange = vi.fn();
  const { rerender } = render(<LevelStepper level={ 0 } format="fahrenheit" label="Base temperature" disabled={ false } onChange={ onChange }/>);
  expect(screen.getByRole('spinbutton', { name: 'Base temperature' })).toHaveTextContent('83°F');
  fireEvent.click(screen.getByRole('button', { name: 'Increase base temperature' }));
  expect(onChange).toHaveBeenLastCalledWith(1);
  rerender(<LevelStepper level={ 10 } format="level" label="Base temperature" disabled={ false } onChange={ onChange }/>);
  expect(screen.getByRole('spinbutton', { name: 'Base temperature' })).toHaveTextContent('+10');
  expect(screen.getByRole('button', { name: 'Increase base temperature' })).toBeDisabled();
  fireEvent.keyDown(screen.getByRole('spinbutton', { name: 'Base temperature' }), { key: 'ArrowDown' });
  expect(onChange).toHaveBeenLastCalledWith(9);
});
