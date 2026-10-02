import { http, HttpResponse } from 'msw';
import { server } from '@test/setup';

export const SIDE_ON = 'A side is on. The bed keeps its current temperature, but schedules and alarms stop for up to five minutes.';

// Answers 409 with reasons until a request confirms, as the server does, and
// records every body it receives (undefined when a request has none).
export function serveInUse(path: string, reasons: string[]) {
  const bodies: unknown[] = [];
  server.use(http.post(path, async ({ request }) => {
    const text = await request.text();
    const body = text ? JSON.parse(text) : undefined;
    bodies.push(body);
    if ((body as { confirmInUse?: boolean } | undefined)?.confirmInUse === true || reasons.length === 0) {
      return new HttpResponse(null, { status: 204 });
    }
    return HttpResponse.json({ error: 'in use', message: 'in use', reasons }, { status: 409 });
  }));
  return bodies;
}
