import express from 'express';
import cors from 'cors';
import logger from '../logger.js';
import { attachRequestCompletionLogging } from './requestLogging.js';
import os from 'os';
import { isIP } from 'net';
// Include every non-internal IPv4 /24 so interface order cannot exclude the LAN.
export function getLocalSubnetPrefixes() {
    const interfaces = os.networkInterfaces();
    const prefixes = [];
    for (const interfaceName in interfaces) {
        const networkInterface = interfaces[interfaceName];
        if (!networkInterface)
            continue;
        for (const network of networkInterface) {
            if (network.family !== 'IPv4' || network.internal)
                continue;
            const parts = network.address.split('.');
            if (parts.length !== 4)
                continue;
            prefixes.push(`${parts[0]}.${parts[1]}.${parts[2]}.`);
        }
    }
    return prefixes;
}
function parseConfiguredOrigin() {
    const value = process.env.ALLOWED_ORIGIN;
    if (!value || value === '*')
        return value;
    try {
        const parsed = new URL(value);
        if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== value)
            throw new Error('Invalid origin');
        return parsed.origin;
    }
    catch {
        logger.warn('Ignoring invalid ALLOWED_ORIGIN; use an http(s) origin including its scheme and optional port');
        return undefined;
    }
}
const configuredOrigin = parseConfiguredOrigin();
let subnetPrefixes = [];
let subnetRefreshAt = 0;
function localSubnetPrefixes() {
    if (Date.now() >= subnetRefreshAt) {
        subnetPrefixes = getLocalSubnetPrefixes();
        subnetRefreshAt = Date.now() + 30_000;
    }
    return subnetPrefixes;
}
export function isAllowedOrigin(origin) {
    if (!origin) {
        return true;
    }
    if (configuredOrigin === '*') {
        return true;
    }
    try {
        const parsed = new URL(origin);
        // An Origin is just scheme, host and port, never credentials or a path.
        if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin)
            return false;
        if (configuredOrigin && parsed.origin === configuredOrigin)
            return true;
        const hostname = parsed.hostname;
        if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]')
            return true;
        if (/^[a-z0-9-]+\.local$/i.test(hostname))
            return true;
        return isIP(hostname) === 4 && localSubnetPrefixes().some(prefix => hostname.startsWith(prefix));
    }
    catch {
        return false;
    }
}
export default function (app) {
    app.use((req, res, next) => {
        attachRequestCompletionLogging(req, res, logger);
        next();
    });
    app.use((req, res, next) => {
        if (!isAllowedOrigin(req.headers.origin)) {
            res.status(403).json({ error: 'Origin is not allowed' });
            return;
        }
        next();
    });
    app.use(cors({ origin: true }));
    app.use(express.json());
    // Logging
    app.use((req, res, next) => {
        const clientIp = req.headers['x-forwarded-for'] || req.ip;
        const method = req.method;
        const endpoint = req.originalUrl;
        logger.debug(`${method} ${endpoint} - IP: ${clientIp}`);
        next();
    });
}
//# sourceMappingURL=middleware.js.map