import { useState } from 'react';
import { Accordion, AccordionDetails, AccordionSummary, Button, Typography } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import StatusRow from './StatusRow.tsx';
import { ServerStatusKey, ServerStatus, StatusInfo, Status } from '@api/serverStatusSchema.ts';
import { needsAttention } from './statusMeta';
import { sx, weight } from '@design/tokens';

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
  const rank = (key: ServerStatusKey) => STATUS_ORDER[data[key]?.status ?? 'healthy'];
  const ranked = () => [...keys].sort((left, right) => rank(left) - rank(right));
  const attention = keys.filter(key => needsAttention(data[key]?.status) || attentionKeys.includes(key));
  // Order and expansion come from the first answer and then belong to the user, so updates never move a row.
  const [first] = useState(ranked);
  const [expanded, setExpanded] = useState(attention.length > 0);
  const ordered = [...first.filter(key => keys.includes(key)), ...ranked().filter(key => !first.includes(key))];
  // A row on screen stays there, and rows healthy at the first look stay behind "Show healthy" until the user opens them,
  // even once nothing needs attention.
  const [showAll] = useState(attention.length === 0);
  const [onScreen, setOnScreen] = useState<ServerStatusKey[]>([]);
  const listed = ordered.filter(key => showAll || data[key]?.status !== 'healthy' || onScreen.includes(key));
  if (listed.some(key => !onScreen.includes(key))) setOnScreen([...onScreen, ...listed.filter(key => !onScreen.includes(key))]);
  const folded = ordered.filter(key => !listed.includes(key));
  const counts = (['healthy', 'not_started', 'started', 'waiting_for_data', 'retrying', 'restarting', 'failed'] as Status[])
    .map(status => {
      const count = keys.filter(key => data[key]?.status === status).length;
      const label = { healthy: 'healthy', not_started: 'starting', started: 'running', waiting_for_data: 'waiting for data',
        retrying: 'retrying', restarting: 'restarting', failed: 'failed' }[status];
      return count ? `${count} ${label}` : '';
    }).filter(Boolean).join(', ');
  if (keys.length === 0) return null;
  return (
    <Accordion
      disableGutters
      expanded={ expanded }
      onChange={ (_event, value) => setExpanded(value) }
      sx={ sx.glassAccordion }
      slotProps={ { transition: { unmountOnExit: true }, heading: { component: 'h2' } } }
    >
      <AccordionSummary expandIcon={ <ExpandMoreIcon/> }>
        <Typography sx={ { fontSize: 16, fontWeight: weight.medium } }>
          { label } · { counts }
        </Typography>
      </AccordionSummary>
      <AccordionDetails>
        { ordered.filter(key => showHealthy || listed.includes(key)).map((key, index) => (
          <StatusRow key={ key } job={ key } statusInfo={ data[key] as StatusInfo } divider={ index > 0 }/>
        )) }
        { folded.length > 0 && <Button
          sx={ { px: 0, justifyContent: 'flex-start' } }
          onClick={ () => setShowHealthy(value => !value) }>
          { showHealthy ? 'Hide healthy services' : `Show ${folded.length} healthy` }
        </Button> }
      </AccordionDetails>
    </Accordion>
  );
}
