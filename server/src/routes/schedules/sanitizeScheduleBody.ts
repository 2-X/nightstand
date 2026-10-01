import _ from 'lodash';

// Known day-level fields - anything else (e.g. a stale `elevations` key left
// over from older versions) gets dropped before schema validation, since the
// strict schema would otherwise 400 on a round-trip of existing
// schedulesDB.json data.
const KNOWN_DAY_KEYS = ['temperatures', 'power', 'alarm', 'alarms'];

// Only objects are mapped. A side or day of any other type, such as a number
// or a string, is passed through for the schema to refuse; mapping it used to
// turn it into an empty update that answered 200. A missing or null one is
// still an empty update, as before.
const mapObject = (value: unknown, map: (child: unknown) => unknown): unknown => {
  if (value === undefined || value === null) return {};
  return _.isPlainObject(value) ? _.mapValues(value as Record<string, unknown>, map) : value;
};

export function sanitizeScheduleBody(body: unknown): Record<string, Record<string, unknown>> {
  return mapObject(body, sideSchedule => mapObject(sideSchedule, daySchedule => (
    daySchedule === undefined || daySchedule === null || _.isPlainObject(daySchedule)
      ? _.pick(daySchedule, KNOWN_DAY_KEYS) : daySchedule
  ))) as Record<string, Record<string, unknown>>;
}
