import { expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { useNavigate } from 'react-router-dom';
import { renderWithProviders } from '@test/renderWithProviders';
import Navbar from './Navbar';

function HistoryControls() {
  const navigate = useNavigate();
  return (
    <>
      <button onClick={ () => navigate('/settings/versions') }>Open software</button>
      <button onClick={ () => navigate(-1) }>Back</button>
      <Navbar />
    </>
  );
}

it('four named destinations track nested routes and browser Back', async () => {
  const { user } = renderWithProviders(<HistoryControls />, { initialRoute: '/sleep' });
  const navigation = screen.getByRole('navigation', { name: 'Primary mobile' });
  const links = within(navigation).getAllByRole('link');
  expect(links.map((link) => link.textContent)).toEqual(['Bed', 'Schedule', 'Sleep', 'Settings']);
  expect(within(navigation).getByRole('link', { name: 'Sleep' })).toHaveAttribute('aria-current', 'page');
  await user.click(screen.getByRole('button', { name: 'Open software' }));
  expect(within(navigation).getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page');
  await user.click(screen.getByRole('button', { name: 'Back' }));
  expect(within(navigation).getByRole('link', { name: 'Sleep' })).toHaveAttribute('aria-current', 'page');
});
