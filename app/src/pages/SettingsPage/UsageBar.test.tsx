import { expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { palette } from '@design/tokens';
import UsageBar from './UsageBar';

it('draws a track that differs from the card it sits on', () => {
  render(<UsageBar label="Storage" usedBytes={ 1.6e9 } totalBytes={ 15e9 } usedPercent={ 11 }/>);
  const track = getComputedStyle(screen.getByRole('progressbar')).backgroundColor;
  expect(track).toBe('rgb(35, 40, 46)');
  expect(track).not.toBe('rgb(18, 21, 24)');
  expect(palette.border.subtle.toLowerCase()).toBe('#23282e');
});
