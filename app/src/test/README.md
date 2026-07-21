# Testing the app

Run the suite from `app/` with `npm test` (this runs `vitest run`).

The harness runs under jsdom with a single MSW server (`src/test/setup.ts`)
that serves the same mock `handlers` the hosted demo uses. It listens with
`onUnhandledRequest: 'error'`, so any request the app makes with no matching
handler fails the test instead of silently returning nothing. Handlers reset
after every test, so one test's `server.use` override cannot leak into the
next.

To render a single component, use `renderWithProviders(<Component />, {
initialRoute })` from `@test/renderWithProviders`. It wraps the component in
the app's real provider stack (React Query, theme, date localization, app
store, router) and returns `{ user, queryClient, ...RTL }`, matching what the
app actually mounts in production.

To render the whole navigable app at a starting route, for cross-page or
conditional-navigation tests, use `renderApp(route)` instead.

To override one endpoint for a single test, import `server` from
`@test/setup` and call `server.use(http.get(...))`; the override is cleared
automatically after the test.

Colocate tests as `*.test.tsx` next to the component they cover. Example,
adapted from `RevertToStockRow.test.tsx`:

```tsx
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '@test/renderWithProviders';
import { server } from '@test/setup';
import RevertToStockRow from './RevertToStockRow';

it('closes the confirm dialog on Cancel and fires no request', async () => {
  let reverted = false;
  server.use(
    http.post('*/update/revert-to-stock', () => {
      reverted = true;
      return HttpResponse.json({});
    }),
  );

  const { user } = renderWithProviders(<RevertToStockRow runningVersion="3.0.0" />);

  await user.click(screen.getByText('Revert to stock upstream free-sleep'));
  expect(await screen.findByRole('dialog')).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: 'Cancel' }));

  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(reverted).toBe(false);
});
```
