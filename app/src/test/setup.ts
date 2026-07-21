import { afterAll, afterEach, beforeAll } from 'vitest';
import { cleanup } from '@testing-library/react';
import { setupServer } from 'msw/node';
import '@testing-library/jest-dom/vitest';

import { handlers } from '../mocks/handlers';

// One MSW server for the whole suite, serving the same handlers the hosted
// demo uses. onUnhandledRequest 'error' turns any request the app makes that
// no handler covers into a test failure, so mock drift surfaces loudly instead
// of returning undefined.
export const server = setupServer(...handlers);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => server.close());
