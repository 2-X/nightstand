import express, { Express } from 'express';
import cors from 'cors';
import logger from '../logger.js';
import { attachRequestCompletionLogging } from './requestLogging.js';

import os from 'os';

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN;

function getLocalIp(): string {
  const interfaces = os.networkInterfaces();
  for (const interfaceName in interfaces) {
    const networkInterface = interfaces[interfaceName];
    if (!networkInterface) continue;

    for (const network of networkInterface) {
      if (network.family === 'IPv4' && !network.internal) {
        return network.address;
      }
    }
  }
  return 'localhost'; // Default to localhost if LAN IP isn't found
}

// With no auth on the API, CORS is the only thing stopping another host on a
// shared/guest network from issuing state-changing requests, so trusting the
// entire RFC1918 range (192.168.*/172.16.*/10.0.*) is too broad. Derive the
// pod's actual subnet(s) from network interfaces instead.
//
// getLocalIp() alone isn't enough here: os.networkInterfaces() has no
// LAN-vs-other preference, and a Tailscale interface (a supported optional
// install) adds its own non-internal IPv4 address. If that happened to
// enumerate first, getLocalIp() would return the Tailscale address and every
// legitimate LAN origin would fail CORS. Collect every non-internal IPv4
// interface's /24 instead of picking just one, so the actual LAN subnet is
// always included regardless of interface ordering.
export function getLocalSubnetPrefixes(): string[] {
  const interfaces = os.networkInterfaces();
  const prefixes: string[] = [];
  for (const interfaceName in interfaces) {
    const networkInterface = interfaces[interfaceName];
    if (!networkInterface) continue;

    for (const network of networkInterface) {
      if (network.family !== 'IPv4' || network.internal) continue;
      const parts = network.address.split('.');
      if (parts.length !== 4) continue;
      prefixes.push(`${parts[0]}.${parts[1]}.${parts[2]}.`);
    }
  }
  return prefixes;
}

/**
 * Check if the request origin is allowed, i.e., from localhost or LAN IP, or
 * matches the `ALLOWED_ORIGIN` environment variable. The function also allows
 * requests with no origin (e.g., `curl`).
 *
 * If `ALLOWED_ORIGIN` is set to a wildcard (`*`), all origins are allowed.
 *
 * @param origin - The origin to check.
 * @returns True if the origin is allowed, false otherwise.
 */
function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) {
    return true;
  }

  if (ALLOWED_ORIGIN === '*') {
    return true;
  }

  if (
    origin.startsWith(`http://${getLocalIp()}:`) ||
    origin.startsWith('http://localhost') ||
    // mDNS names (http://eight-pod.local:3000). The app is served as an ES
    // module, and module script requests always carry an Origin header, so
    // same-origin loads via the .local name must pass this check too.
    /^http:\/\/[a-z0-9-]+\.local(:\d+)?$/i.test(origin) ||
    getLocalSubnetPrefixes().some(prefix => origin.startsWith(`http://${prefix}`)) ||
    (ALLOWED_ORIGIN && origin.startsWith(ALLOWED_ORIGIN))
  ) {
    return true;
  }

  return false;
}

export default function (app: Express) {
  app.use((req, res, next) => {
    attachRequestCompletionLogging(req, res, logger);
    next();
  });

  app.use(express.json());

  // Allow local development
  app.use(
    cors({
      origin: (origin, callback) => {
        if (isAllowedOrigin(origin)) {
          return callback(null, true);
        }

        return callback(new Error('Not allowed by CORS'));
      }
    })
  );

  // Logging
  app.use((req, res, next) => {
    const clientIp = req.headers['x-forwarded-for'] || req.ip;
    const method = req.method;
    const endpoint = req.originalUrl;
    logger.debug(`${method} ${endpoint} - IP: ${clientIp}`);
    next();
  });
}
