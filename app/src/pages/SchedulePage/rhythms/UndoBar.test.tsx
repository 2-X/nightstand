import { afterEach, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import UndoBar from './UndoBar';

afterEach(() => vi.useRealTimers());

it('stays until it is dismissed, so there is time to reach Undo', () => {
  vi.useFakeTimers();
  const onClose = vi.fn();
  render(<UndoBar message="Saturday now uses Workday" disabled={ false } onUndo={ vi.fn() } onClose={ onClose }/>);
  act(() => vi.advanceTimersByTime(10 * 60_000));
  expect(screen.getByText('Saturday now uses Workday')).toBeInTheDocument();
  expect(onClose).not.toHaveBeenCalled();
});
