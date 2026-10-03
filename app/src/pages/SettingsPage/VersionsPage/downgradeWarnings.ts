import semver from 'semver';
import type { Release } from '@api/releases';

export function downgradeWarnings(release: Release, runningVersion: string | undefined): string[] {
  if (!runningVersion || !semver.valid(runningVersion) || !semver.valid(release.version)
    || !semver.lt(release.version, runningVersion)) return [];
  const warnings: string[] = [];
  if (semver.lt(release.version, '3.4.0')) {
    warnings.push('Presence auto-off cannot be switched off in this version. Older versions run it automatically.');
    warnings.push('The target uses its older firewall rules, including older handling of port 1337. '
      + 'Updating again restores the newer rules.');
  }
  if (semver.lt(release.version, '3.3.0')) {
    warnings.push(`Version ${release.version} keeps sensor recordings for at most 14 days and does not check free space.`);
  }
  if (semver.gte(runningVersion, '3.5.0') && semver.lt(release.version, '3.5.0')) {
    warnings.push('Rhythms and pause are not honored by this target. Its regular schedules may run even if a newer version paused them.');
  }
  if (release.kind === 'bundle') {
    const features = [
      ['sleep-stages-score', 'Sleep score'],
      ['level-temperature-display', 'Level temperature display'],
      ['one-off-alarms', 'One-time alarms'],
      ['base-control', 'Adjustable base control'],
    ];
    const missing = features.filter(([feature]) => !release.features.includes(feature)).map(([, label]) => label);
    if (missing.length) warnings.push(`The target does not list support for: ${missing.join(', ')}.`);
  }
  return warnings;
}
