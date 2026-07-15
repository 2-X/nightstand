// `MemAvailable` (not `MemFree`) is the number that matches what users mean
// by "free RAM": it accounts for reclaimable page cache/buffers, which on
// this pod is usually the majority of "used" memory day-to-day.
export function parseMeminfo(text) {
    const totalMatch = text.match(/^MemTotal:\s+(\d+)\s*kB$/m);
    const availableMatch = text.match(/^MemAvailable:\s+(\d+)\s*kB$/m);
    if (!totalMatch || !availableMatch)
        return null;
    const totalKb = Number(totalMatch[1]);
    const availableKb = Number(availableMatch[1]);
    if (Number.isNaN(totalKb) || Number.isNaN(availableKb))
        return null;
    return { totalKb, availableKb };
}
//# sourceMappingURL=parseMeminfo.js.map