import { Box, Typography } from '@mui/material';
import moment from 'moment-timezone';
import GlassCard from '@design/GlassCard';
import { palette, typography } from '@design/tokens';
import { PresenceSide } from '@api/presence.ts';
import { SideStatus } from '@api/deviceStatusSchema';

export type LatestVital = { value: number; timestampMs: number };

type PersonCardProps = {
  /** Per-side display name from settings (e.g. "Kris"). */
  name: string;
  /** Series color for this side - doubles as the card's identity color. */
  color: string;
  presence?: PresenceSide;
  heartRate?: LatestVital;
  hrv?: LatestVital;
  breathingRate?: LatestVital;
  /** Live bed state for this side from device status. */
  sideStatus?: SideStatus;
};

// Latest readings older than this are shown dimmed - the sensor only writes
// while the person is present, so an old value is "last known", not live.
const STALE_AFTER_MS = 10 * 60 * 1000;

function formatVital(vital: LatestVital | undefined, unit: string): { text: string; stale: boolean } {
  if (!vital) return { text: '—', stale: false };
  return {
    text: `${Math.round(vital.value)} ${unit}`,
    stale: Date.now() - vital.timestampMs > STALE_AFTER_MS,
  };
}

// Rename `text` -> `value` so formatVital results drop into the row list.
function remap({ text, stale }: { text: string; stale: boolean }): { value: string; stale: boolean } {
  return { value: text, stale };
}

/**
 * Live snapshot card for one person: presence, current heart rate (hero
 * number), HRV, breathing rate, and bed temperature. Two of these render
 * side by side at the top of the Vitals page.
 */
export default function PersonCard({
  name,
  color,
  presence,
  heartRate,
  hrv,
  breathingRate,
  sideStatus,
}: PersonCardProps) {
  const present = presence?.present ?? false;
  const heart = formatVital(heartRate, 'bpm');

  const secondaryRows: { label: string; value: string; stale: boolean }[] = [
    { label: 'HRV', ...remap(formatVital(hrv, 'ms')) },
    { label: 'Breathing', ...remap(formatVital(breathingRate, 'brpm')) },
    {
      label: 'Bed',
      value: sideStatus?.isOn
        ? `${Math.round(sideStatus.currentTemperatureF)}° → ${Math.round(sideStatus.targetTemperatureF)}°`
        : 'Off',
      stale: false,
    },
  ];

  return (
    <GlassCard sx={ { p: 2, minWidth: 0 } }>
      { /* Name + presence dot */ }
      <Box sx={ { display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 } }>
        <Box
          sx={ {
            width: 8,
            height: 8,
            borderRadius: '50%',
            backgroundColor: present ? palette.accent.green : palette.text.disabled,
            flexShrink: 0,
            ...(present && {
              animation: 'presencePulse 2s ease-in-out infinite',
              '@keyframes presencePulse': {
                '0%, 100%': { boxShadow: `0 0 0 0 ${palette.accent.green}66` },
                '50%': { boxShadow: `0 0 0 5px ${palette.accent.green}00` },
              },
            }),
          } }
        />
        <Typography
          noWrap
          sx={ { ...typography.sectionLabel, color, minWidth: 0 } }
        >
          { name }
        </Typography>
      </Box>

      { /* Hero heart rate */ }
      <Typography
        sx={ {
          fontSize: { xs: '1.9rem', sm: '2.4rem' },
          fontWeight: 500,
          lineHeight: 1.05,
          letterSpacing: '-0.02em',
          fontVariantNumeric: 'tabular-nums',
          color: heart.stale ? palette.text.tertiary : palette.text.primary,
          whiteSpace: 'nowrap',
        } }
      >
        { heart.text }
      </Typography>
      <Typography sx={ { fontSize: '0.72rem', color: palette.text.tertiary, mb: 1.5 } }>
        { heartRate
          ? `heart rate · ${moment(heartRate.timestampMs).fromNow()}`
          : present ? 'heart rate · measuring…' : 'out of bed' }
      </Typography>

      { /* Secondary metrics */ }
      { secondaryRows.map((row) => (
        <Box
          key={ row.label }
          sx={ {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            py: 0.6,
            borderTop: `1px solid ${palette.border.subtle}`,
          } }
        >
          <Typography sx={ { fontSize: '0.78rem', color: palette.text.tertiary } }>
            { row.label }
          </Typography>
          <Typography
            sx={ {
              fontSize: '0.95rem',
              fontWeight: 500,
              fontVariantNumeric: 'tabular-nums',
              color: row.stale ? palette.text.tertiary : palette.text.secondary,
            } }
          >
            { row.value }
          </Typography>
        </Box>
      )) }
    </GlassCard>
  );
}
