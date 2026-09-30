import { useState } from 'react';
import { Accordion, AccordionDetails, AccordionSummary, Button, Typography } from '@mui/material';
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
  attentionKeys?: ServerStatusKey[];
};

export default function GroupCard({ label, keys, data, attentionKeys = [] }: GroupCardProps) {
  const [showHealthy, setShowHealthy] = useState(false);
  const [expanded, setExpanded] = useState<{ issues: string; value: boolean }>();
  const nonHealthy = keys.filter(key => data[key]?.status !== 'healthy')
    .sort((left, right) => STATUS_ORDER[data[left]!.status] - STATUS_ORDER[data[right]!.status]);
  const attention = keys.filter(key => needsAttention(data[key]?.status) || attentionKeys.includes(key));
  const issues = attention.map(key => `${key}:${data[key]?.status}`).join(',');
  const counts = (['healthy', 'not_started', 'started', 'waiting_for_data', 'retrying', 'restarting', 'failed'] as Status[])
    .map(status => {
      const count = keys.filter(key => data[key]?.status === status).length;
      const label = { healthy: 'healthy', not_started: 'starting', started: 'running', waiting_for_data: 'waiting for data',
        retrying: 'retrying', restarting: 'restarting', failed: 'failed' }[status];
      return count ? `${count} ${label}` : '';
    }).filter(Boolean).join(', ');
  const healthy = keys.filter(key => data[key]?.status === 'healthy');
  if (keys.length === 0) return null;
  return (
    <Accordion
      disableGutters
      expanded={ expanded?.issues === issues ? expanded.value : attention.length > 0 }
      onChange={ (_event, value) => setExpanded({ issues, value }) }
      sx={ sx.glassAccordion }
      slotProps={ { transition: { unmountOnExit: true }, heading: { component: 'h2' } } }
    >
      <AccordionSummary expandIcon={ <ExpandMoreIcon/> }>
        <Typography sx={ { fontSize: 16, fontWeight: 500 } }>
          { label } · { counts }
        </Typography>
      </AccordionSummary>
      <AccordionDetails>
        { [...nonHealthy, ...(attention.length === 0 || showHealthy ? healthy : [])].map((key, index) => (
          <StatusRow key={ key } job={ key } statusInfo={ data[key] as StatusInfo } divider={ index > 0 }/>
        )) }
        { attention.length > 0 && healthy.length > 0 && <Button
          sx={ { px: 0, justifyContent: 'flex-start' } }
          onClick={ () => setShowHealthy(value => !value) }>
          { showHealthy ? 'Hide healthy services' : `Show ${healthy.length} healthy` }
        </Button> }
      </AccordionDetails>
    </Accordion>
  );
}
