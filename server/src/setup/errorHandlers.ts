import { Express, Request, Response, NextFunction } from 'express';
import { FrankenCommandTimeoutError, FrankenUnavailableError } from '../8sleep/frankenServer.js';
import logger from '../logger.js';

export function registerErrorHandlers(app: Express) {
  // --- JSON parse / body parser errors (normalize to 400)
  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    // If this isn't a body-parse error, pass it on to the central handler
    if (!err || err.type !== 'entity.parse.failed') return next(err);
    res.status(400).json({ error: { message: 'Invalid JSON' } });
  });

  // --- Hardware unavailable: the command was not sent, or got no answer
  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    if (err instanceof FrankenUnavailableError) {
      logger.warn(err.message);
      res.status(503).json({ error: { message: 'Pod hardware is not connected. Try again in a moment.' } });
      return;
    }
    if (err instanceof FrankenCommandTimeoutError) {
      logger.warn(err.message);
      res.status(503).json({ error: { message: 'Pod did not respond in time. Try again in a moment.' } });
      return;
    }
    next(err);
  });

  // --- Central error handler (must be AFTER routes and special-case handlers)
  // eslint-disable-next-line no-unused-vars,@typescript-eslint/no-unused-vars
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const isProd = process.env.NODE_ENV === 'production';
    const status = Number(err?.status) || 500;
    const body: any = { error: { message: err?.message || 'Internal Server Error' } };
    if (!isProd) body.error.stack = err?.stack;
    logger.error(body);
    logger.error(JSON.stringify(body));
    res.status(status).json(body);
  });
}
