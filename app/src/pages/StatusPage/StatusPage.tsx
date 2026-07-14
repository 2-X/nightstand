import { useMemo, useState } from 'react';
import moment from 'moment-timezone';
import { useServerStatus } from '@api/serverStatus.ts';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Chip,
  CircularProgress,
  Typography,
} from '@mui/material';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import ErrorRoundedIcon from '@mui/icons-material/ErrorRounded';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';

import PageContainer from '../PageContainer.tsx';
import GlassCard from '@design/GlassCard';
import StatusRow from './StatusRow.tsx';
import GroupCard from './GroupCard.tsx';
import { ServerStatusKey, ServerStatus, StatusInfo } from '@api/serverStatusSchema.ts';
import { palette, sx } from '@design/tokens';
import { STATUS_META, GROUP_LABELS, StatusGroup } from './statusMeta.ts';

const UNHEALTHY_STATUSES = new Set(['failed', 'retrying', 'restarting']);

function groupKeys(data: ServerStatus): Record<StatusGroup, ServerStatusKey[]> {
  const groups: Record<StatusGroup, ServerStatusKey[]> = { schedules: [], biometrics: [], core: [] };
  (Object.keys(data) as ServerStatusKey[]).forEach((key) => {
    groups[STATUS_META[key].group].push(key);
  });
  return groups;
}

export default function StatusPage() {
  // service-health pushes from the WebSocket invalidate this query, so a
  // 30s safety-net poll is enough - no need for the old 5s.
  const { data, isLoading, dataUpdatedAt } = useServerStatus(30_000);
  const [coreExpanded, setCoreExpanded] = useState(false);
  // `dataUpdatedAt` is 0 until the first fetch resolves - guard so the header
  // doesn't briefly render "Updated" at the Unix epoch (1970) on first paint.
  const formatted = dataUpdatedAt ? moment(dataUpdatedAt).format('h:mm:ss A') : null;

  const groups = useMemo(() => (data ? groupKeys(data) : null), [data]);

  const unhealthy = useMemo(() => {
    if (!data) return [];
    return (Object.keys(data) as ServerStatusKey[])
      .filter((key) => UNHEALTHY_STATUSES.has((data[key] as StatusInfo).status))
      .map((key) => (data[key] as StatusInfo).name);
  }, [data]);

  const coreUnhealthy = useMemo(() => {
    if (!groups || !data) return false;
    return groups.core.some((key) => UNHEALTHY_STATUSES.has((data[key] as StatusInfo).status));
  }, [groups, data]);

  const isAllHealthy = unhealthy.length === 0;
  const summaryTitle = isAllHealthy
    ? 'Everything is running normally'
    : `${unhealthy.length} thing${unhealthy.length > 1 ? 's need' : ' needs'} attention`;

  return (
    <PageContainer
      sx={ {
        mb: 15,
        pt: 3,
        gap: 2,
        alignItems: 'stretch',
      } }
    >
      <Box sx={ { px: 0.5, mb: 0.5 } }>
        <Typography
          sx={ {
            fontSize: '2rem',
            fontWeight: 600,
            letterSpacing: '-0.02em',
            color: palette.text.primary,
            lineHeight: 1.1,
          } }
        >
          System
        </Typography>
        { formatted && (
          <Typography sx={ { fontSize: '0.85rem', color: palette.text.tertiary, mt: 0.25 } }>
            Updated { formatted }
          </Typography>
        ) }
      </Box>

      { isLoading && <CircularProgress sx={ { mx: 'auto' } } /> }

      { data && groups && (
        <Box sx={ { display: 'flex', flexDirection: 'column', gap: 1.5 } }>
          <GlassCard sx={ isAllHealthy ? undefined : { borderColor: palette.accent.red } }>
            <Box sx={ { display: 'flex', alignItems: 'center', gap: 1.5 } }>
              { isAllHealthy ? (
                <CheckCircleRoundedIcon sx={ { color: palette.accent.green, fontSize: 28 } } />
              ) : (
                <ErrorRoundedIcon sx={ { color: palette.accent.red, fontSize: 28 } } />
              ) }
              <Box>
                <Typography sx={ { fontSize: '1rem', fontWeight: 600, color: palette.text.primary } }>
                  { summaryTitle }
                </Typography>
                { !isAllHealthy && (
                  <Typography sx={ { fontSize: '0.8rem', color: palette.text.tertiary, mt: 0.25 } }>
                    { unhealthy.join(', ') }
                  </Typography>
                ) }
              </Box>
            </Box>
          </GlassCard>

          <GroupCard label={ GROUP_LABELS.schedules } keys={ groups.schedules } data={ data } />
          <GroupCard label={ GROUP_LABELS.biometrics } keys={ groups.biometrics } data={ data } />

          { groups.core.length > 0 && (
            <Accordion
              disableGutters
              expanded={ coreExpanded || coreUnhealthy }
              onChange={ (_e, expanded) => setCoreExpanded(expanded) }
              sx={ sx.glassAccordion }
            >
              <AccordionSummary expandIcon={ <ExpandMoreIcon sx={ { color: palette.text.tertiary } } /> }>
                <Box sx={ { display: 'flex', alignItems: 'center', gap: 1.5, width: '100%' } }>
                  <Typography sx={ { ...sx.sectionLabel, mb: 0 } }>{ GROUP_LABELS.core }</Typography>
                  <Chip
                    label={ coreUnhealthy ? 'Needs attention' : 'All healthy' }
                    size="small"
                    color={ coreUnhealthy ? 'error' : 'success' }
                    variant={ coreUnhealthy ? 'filled' : 'outlined' }
                    sx={ { ml: 'auto', fontWeight: 600 } }
                  />
                </Box>
              </AccordionSummary>
              <AccordionDetails>
                { groups.core.map((key, index) => (
                  <StatusRow key={ key } job={ key } statusInfo={ data[key] as StatusInfo } divider={ index > 0 } />
                )) }
              </AccordionDetails>
            </Accordion>
          ) }
        </Box>
      ) }
    </PageContainer>
  );
}
