import { afterAll, afterEach, beforeAll } from 'vitest';
import { cleanup } from '@testing-library/react';
import { setupServer } from 'msw/node';
import '@testing-library/jest-dom/vitest';

import { handlers } from '../mocks/handlers';

// jsdom does not implement scrollIntoView, but several components (the logs
// viewer, chat-style lists) call it to autoscroll. Stub it once for the suite
// so any component under test can call it without throwing.
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView || (() => {});

// One MSW server for the whole suite, serving the same handlers the hosted
// demo uses. onUnhandledRequest 'error' turns any request the app makes that
// no handler covers into a test failure, so mock drift surfaces loudly instead
// of returning undefined.
export const server = setupServer(...handlers);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(async () => {
  cleanup();
  server.resetHandlers();
  // Let any request still in flight deliver its mocked response while this
  // file's jsdom environment is still alive. A response arriving after
  // teardown lands in a scope whose DOM globals are already gone, and the
  // resulting rejection gets reported against whichever file happened to be
  // running rather than the one that started it, which makes it very hard to
  // trace. Most hooks do not forward the query's abort signal to axios, so
  // unmounting alone does not stop the request.
  // Responses are served from memory, but the interceptor needs several turns
  // to deliver one, so yield a few rather than one.
  for (let i = 0; i < 4; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setImmediate(resolve));
  }
});
afterAll(() => server.close());
