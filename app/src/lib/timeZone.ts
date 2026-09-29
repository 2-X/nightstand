export function friendlyTimeZone(zone: string): string {
  try {
    const name = new Intl.DateTimeFormat('en', { timeZone: zone, timeZoneName: 'longGeneric' })
      .formatToParts(new Date()).find(part => part.type === 'timeZoneName')?.value;
    const city = zone.split('/').pop()?.replace(/_/g, ' ');
    return name && city ? `${name} (${city})` : zone;
  } catch {
    return zone;
  }
}
