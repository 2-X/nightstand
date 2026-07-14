import _ from 'lodash';

// Known day-level fields - anything else (e.g. a stale `elevations` key left
// over from older versions) gets dropped before schema validation, since the
// strict schema would otherwise 400 on a round-trip of existing
// schedulesDB.json data.
const KNOWN_DAY_KEYS = ['temperatures', 'power', 'alarm', 'alarms'];

export function sanitizeScheduleBody(body: unknown): Record<string, Record<string, unknown>> {
  return _.mapValues(
    (body ?? {}) as Record<string, Record<string, unknown>>,
    (sideSchedule) => _.mapValues(
      (sideSchedule ?? {}) as Record<string, unknown>,
      (daySchedule) => _.pick(daySchedule, KNOWN_DAY_KEYS),
    ),
  );
}
