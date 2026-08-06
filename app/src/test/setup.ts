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

// A request that is still in flight when a test file's environment is torn
// down delivers its response into a scope whose DOM globals are already gone,
// which throws inside the request interceptor. That rejection is reported
// against whichever file happened to be running rather than the one that
// started the request, so it misdirects badly.
//
// Unmounting cancels queries, because every hook in src/api forwards the
// query's abort signal, but it cannot cancel a plain POST: the save helpers
// are ordinary promises with nothing to cancel them. So rather than guessing
// how many turns a response needs, track what is outstanding and wait for it.
const inFlightRequests = new Set<string>();
server.events.on('request:start', ({ requestId }) => { inFlightRequests.add(requestId); });
server.events.on('request:end', ({ requestId }) => { inFlightRequests.delete(requestId); });

const SETTLE_TIMEOUT_MS = 2_000;

async function waitForRequestsToSettle() {
  const startedAt = Date.now();
  while (inFlightRequests.size > 0 && Date.now() - startedAt < SETTLE_TIMEOUT_MS) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  if (inFlightRequests.size > 0) {
    // Never seen in practice. Say so loudly if it happens, because the
    // alternative is the misdirecting failure described above.
    console.error(
      `${inFlightRequests.size} request(s) did not settle within ${SETTLE_TIMEOUT_MS}ms `
      + 'and may outlive this test environment.',
    );
    inFlightRequests.clear();
  }
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(async () => {
  cleanup();
  // Settle before resetting handlers: a request still in flight would
  // otherwise lose the handler it matched and be reported as unhandled.
  await waitForRequestsToSettle();
  server.resetHandlers();
});
afterAll(() => server.close());
