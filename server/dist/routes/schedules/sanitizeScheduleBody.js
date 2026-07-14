import _ from 'lodash';
// Known day-level fields - anything else (e.g. a stale `elevations` key left
// over from older versions) gets dropped before schema validation, since the
// strict schema would otherwise 400 on a round-trip of existing
// schedulesDB.json data.
const KNOWN_DAY_KEYS = ['temperatures', 'power', 'alarm', 'alarms'];
export function sanitizeScheduleBody(body) {
    return _.mapValues((body ?? {}), (sideSchedule) => _.mapValues((sideSchedule ?? {}), (daySchedule) => _.pick(daySchedule, KNOWN_DAY_KEYS)));
}
//# sourceMappingURL=sanitizeScheduleBody.js.map