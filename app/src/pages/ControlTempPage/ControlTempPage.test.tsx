import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@test/renderWithProviders';
import ControlTempPage from './ControlTempPage';

describe('ControlTempPage', () => {
  it('renders the temperature control', async () => {
    renderWithProviders(<ControlTempPage />, { initialRoute: '/' });
    expect(await screen.findByText('Temperature')).toBeInTheDocument();
  });
});
