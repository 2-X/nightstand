import { expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import DayTabs from './DayTabs';

it('shows short day labels and names each tab in full', () => {
  render(<DayTabs/>);
  const tabs = screen.getAllByRole('tab');
  expect(tabs.map(tab => tab.textContent)).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
  expect(screen.getByRole('tab', { name: 'Wednesday' })).toBeInTheDocument();
});
