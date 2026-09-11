export function temperatureSourceFresh(at, now = Date.now()) {
    const epoch = Date.parse(at ?? '');
    return Number.isFinite(epoch) && epoch <= now && now - epoch <= 90000;
}
//# sourceMappingURL=temperatureFreshness.js.map