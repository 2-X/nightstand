import { useState } from 'react';
import { Accordion, AccordionDetails, AccordionSummary, Typography } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import StatusRow from './StatusRow.tsx';
import { ServerStatusKey, ServerStatus, StatusInfo, Status } from '@api/serverStatusSchema.ts';
import { needsAttention } from './statusMeta';
import { sx } from '@design/tokens';

const STATUS_ORDER: Record<Status, number> = {
  failed: 0, retrying: 1, restarting: 1, not_started: 2, waiting_for_data: 3, started: 4, healthy: 5,
};

type GroupCardProps = {
  label: string;
  keys: ServerStatusKey[];
  data: ServerStatus;
};

export default function GroupCard({ label, keys, data }: GroupCardProps) {
  const [expanded, setExpanded] = useState<boolean | undefined>();
  const nonHealthy = keys.filter(key => data[key]?.status !== 'healthy')
    .sort((left, right) => STATUS_ORDER[data[left]!.status] - STATUS_ORDER[data[right]!.status]);
  const attention = keys.filter(key => needsAttention(data[key]?.status));
  const healthy = keys.filter(key => data[key]?.status === 'healthy');
  if (keys.length === 0) return null;
  return (
    <Accordion
      disableGutters
      expanded={ expanded ?? attention.length > 0 }
      onChange={ (_event, value) => setExpanded(value) }
      sx={ sx.glassAccordion }
      slotProps={ { transition: { unmountOnExit: true } } }
    >
      <AccordionSummary expandIcon={ <ExpandMoreIcon/> }>
        <Typography variant="body2">
          { label } · { healthy.length } healthy{ attention.length > 0 ? `, ${attention.length} needing attention` : '' }
        </Typography>
      </AccordionSummary>
      <AccordionDetails>
        { [...nonHealthy, ...healthy].map((key, index) => (
          <StatusRow key={ key } job={ key } statusInfo={ data[key] as StatusInfo } divider={ index > 0 }/>
        )) }
      </AccordionDetails>
    </Accordion>
  );
}
