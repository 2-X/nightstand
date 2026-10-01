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
const mapObject = (value, map) => {
    if (value === undefined || value === null)
        return {};
    return _.isPlainObject(value) ? _.mapValues(value, map) : value;
};
export function sanitizeScheduleBody(body) {
    return mapObject(body, sideSchedule => mapObject(sideSchedule, daySchedule => (daySchedule === undefined || daySchedule === null || _.isPlainObject(daySchedule)
        ? _.pick(daySchedule, KNOWN_DAY_KEYS) : daySchedule)));
}
//# sourceMappingURL=sanitizeScheduleBody.js.map