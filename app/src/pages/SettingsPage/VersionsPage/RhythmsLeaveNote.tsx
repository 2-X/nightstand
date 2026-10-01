import semver from 'semver';
import { Typography } from '@mui/material';
import { useSettings } from '@api/settings';

// The first version with Rhythms; a target from it on continues a rhythm sleep itself.
const RHYTHMS_SINCE = '3.5.0';

export default function RhythmsLeaveNote({ targetVersion }: { targetVersion?: string }) {
  const { data: settings } = useSettings();
  if (!settings?.features?.rhythms) return null;
  if (targetVersion && semver.valid(targetVersion) && semver.gte(targetVersion, RHYTHMS_SINCE)) return null;
  return <Typography variant="body2" sx={ { mt: 2 } }>
    Rhythms is on. Before the switch, each side goes back to the weekly schedule. A side in a rhythm sleep the weekly
    schedule does not cover stays on until that sleep ends, without its alarm. Your rhythms are kept.
  </Typography>;
}
