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

Colocate tests as `*.test.tsx` next to the component they cover. Example:

```tsx
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '@test/renderWithProviders';
import { server } from '@test/setup';

it('shows an error state when the request fails', async () => {
  server.use(http.get('/api/settings', () => HttpResponse.error()));
  renderWithProviders(<SettingsPanel />);
  expect(await screen.findByText(/failed to load/i)).toBeInTheDocument();
});
```
