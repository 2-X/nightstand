import moment from 'moment-timezone';
const unixTime = (value) => {
    if (value === undefined)
        return undefined;
    if (typeof value !== 'string')
        return null;
    const time = moment(value, moment.ISO_8601, true);
    return time.isValid() ? time.unix() : null;
};
// Returns null when a value would reach the database query as NaN, an array or an unknown side.
export function parseMetricsQuery(query) {
    const { side, startTime, endTime } = query;
    if (side !== undefined && side !== '' && side !== 'left' && side !== 'right')
        return null;
    const start = unixTime(startTime);
    const end = unixTime(endTime);
    if (start === null || end === null)
        return null;
    return { side: side || undefined, start, end };
}
//# sourceMappingURL=metricsQuery.js.map