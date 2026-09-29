import { lazy, Suspense } from 'react';
import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { Routes, Route, Link } from 'react-router-dom';
import { renderApp, renderWithProviders } from '@test/renderWithProviders';
import Layout from './Layout';
import { useScheduleStore } from '../pages/SchedulePage/scheduleStore';
import { getSchedules } from '../mocks/mockData';

const WaitingPage = lazy(() => new Promise<{ default: () => React.JSX.Element }>(() => {}));

describe('Persistent route shell', () => {
  it('offers a way home from an unknown URL', async () => {
    renderApp('/this-page-does-not-exist');
    expect(await screen.findByText('Page not found')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Go to Bed' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('navigation', { name: 'Primary mobile' })).toBeVisible();
  });
  it('keeps navigation visible and discards drafts while the next route suspends', async () => {
    useScheduleStore.getState().setOriginalSchedules(getSchedules());
    useScheduleStore.getState().updateSelectedSchedule({ power: { on: '12:00' } });
    expect(useScheduleStore.getState().changesPresent).toBe(true);
    const { user } = renderWithProviders(<Suspense fallback={ <span>Outer loading</span> }><Routes>
      <Route element={ <Layout/> }>
        <Route path="schedules" element={ <Link to="/waiting">Leave schedule</Link> }/>
        <Route path="waiting" element={ <WaitingPage/> }/>
      </Route>
    </Routes></Suspense>, { initialRoute: '/schedules' });
    await user.click(screen.getByRole('link', { name: 'Leave schedule' }));
    await waitFor(() => expect(useScheduleStore.getState().changesPresent).toBe(false));
    expect(screen.getByRole('navigation', { name: 'Primary mobile' })).toBeVisible();
    expect(screen.queryByText('Outer loading')).not.toBeInTheDocument();
  });
});
