import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import TimeZoneSelector from './TimeZoneSelector';
import { getSettings } from '../../../mocks/mockData';

describe('TimeZoneSelector', () => {
  it('lists a stored zone that the picker does not offer, so the select is not blank', () => {
    const settings = { ...getSettings(), timeZone: 'Pacific/Kiritimati' } as unknown as ReturnType<typeof getSettings>;
    render(<TimeZoneSelector settings={ settings } updateSettings={ vi.fn() }/>);
    const select = screen.getByRole('combobox', { name: 'Time zone' });
    expect(select).toHaveTextContent(/Kiritimati/);
    fireEvent.mouseDown(select);
    expect(within(screen.getByRole('listbox')).getAllByRole('option')[0]).toHaveTextContent(/Kiritimati/);
  });

  it('shows an unset zone as an error with an empty select', () => {
    const settings = { ...getSettings(), timeZone: null } as unknown as ReturnType<typeof getSettings>;
    render(<TimeZoneSelector settings={ settings } updateSettings={ vi.fn() }/>);
    expect(screen.getByRole('combobox', { name: 'Time zone' })).toHaveAttribute('aria-invalid', 'true');
  });
});
