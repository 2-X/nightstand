export function temperatureSourceFresh(at: string | null | undefined, now = Date.now()): boolean {
  const epoch = Date.parse(at ?? '');
  return Number.isFinite(epoch) && epoch <= now && now - epoch <= 90000;
}
