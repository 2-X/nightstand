
!function(){try{var e="undefined"!=typeof window?window:"undefined"!=typeof global?global:"undefined"!=typeof globalThis?globalThis:"undefined"!=typeof self?self:{},n=(new e.Error).stack;n&&(e._sentryDebugIds=e._sentryDebugIds||{},e._sentryDebugIds[n]="9c2082be-7c09-5f5a-a34d-5c1a39ec1c5c")}catch(e){}}();
import * as Sentry from '@sentry/node';
import logger from './logger.js';
import { getFranken } from './8sleep/frankenServer.js';
import './jobs/jobScheduler.js';
import settingsDB from './db/settings.js';
export async function setupSentryTags() {
    logger.debug('Setting up sentry tags');
    const franken = await getFranken();
    const deviceStatus = await franken.getDeviceStatus();
    Sentry.setUser({ id: settingsDB.data.id });
    Sentry.setTag('hub_version', deviceStatus.hubVersion);
    Sentry.setTag('cover_version', deviceStatus.coverVersion);
    logger.debug('Set up sentry tags');
}
//# sourceMappingURL=setupSentryTags.js.map
//# debugId=9c2082be-7c09-5f5a-a34d-5c1a39ec1c5c
