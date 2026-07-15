// `df -k -P` and `du -sk` are parsed here as pure functions so the parsing
// logic is unit-testable without shelling out. `-P` forces POSIX single-line
// output: plain `df -k` wraps onto two lines on this busybox/coreutils
// build when the filesystem name (e.g. /dev/mmcblk0p8) is long.
export function parseDfOutput(output) {
    const lines = output.trim().split('\n');
    const dataLine = lines[lines.length - 1];
    if (!dataLine)
        return null;
    const parts = dataLine.trim().split(/\s+/);
    // Index from the end (mount point, capacity%, available, used, total) so a
    // wrapped continuation line, missing the leading filesystem-name field,
    // still parses the same as a full single-line row.
    if (parts.length < 5)
        return null;
    const totalKb = Number(parts[parts.length - 5]);
    const usedKb = Number(parts[parts.length - 4]);
    const availableKb = Number(parts[parts.length - 3]);
    if ([totalKb, usedKb, availableKb].some((n) => Number.isNaN(n)))
        return null;
    return { totalKb, usedKb, availableKb };
}
export function parseDuOutput(output) {
    const firstLine = output.trim().split('\n')[0] ?? '';
    const kb = Number(firstLine.trim().split(/\s+/)[0]);
    return Number.isNaN(kb) ? 0 : kb;
}
//# sourceMappingURL=parseDiskUsage.js.map