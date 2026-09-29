import { expect, it } from 'vitest';
import { downgradeWarnings } from './downgradeWarnings';

it.each(['3.0.0', '3.0.1', '3.1.0', '3.2.0', '3.2.1', '3.2.2'])(
  'explains the archive limit for version %s', version => {
    const warnings = downgradeWarnings({ kind: 'agent', version, date: '2026-01-01', channel: 'stable' }, '3.4.0');
    expect(warnings).toContain(`Version ${version} keeps sensor recordings for at most 14 days and does not check free space.`);
  },
);

it('does not claim a retention cap for targets that check free space', () => {
  const warnings = downgradeWarnings({ kind: 'agent', version: '3.3.0', date: '2026-01-01', channel: 'stable' }, '3.4.0');
  expect(warnings.join(' ')).not.toMatch(/14 days|free space/);
});
