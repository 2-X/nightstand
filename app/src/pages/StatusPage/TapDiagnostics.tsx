import { useState } from 'react';
import { Accordion, AccordionDetails, AccordionSummary, Alert, Button, Typography } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import axios from '@api/api';
import type { FirmwareSnapshot } from '@api/firmware';

export default function TapDiagnostics({ data }: { data: FirmwareSnapshot }) {
  const [error, setError] = useState(false);
  const exportEvents = async () => {
    setError(false);
    try {
      const response = await axios.get('/services/firmware/taps/export');
      const url = URL.createObjectURL(new Blob([JSON.stringify(response.data, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'tap-diagnostics.json';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setError(true); }
  };
  return <Accordion>
    <AccordionSummary expandIcon={ <ExpandMoreIcon /> }>Tap diagnostics ({ data.taps.length })</AccordionSummary>
    <AccordionDetails>
      <Typography variant="body2">Diagnostic candidates only. Retained for 30 minutes, up to 1,000 events.</Typography>
      { data.availability === 'Monitoring unavailable' && <Typography>Monitoring unavailable</Typography> }
      <Button onClick={ () => void exportEvents() }>Export tap diagnostics</Button>
      { error && <Alert severity="warning">Could not export tap diagnostics.</Alert> }
      { data.taps.length === 0 && <Typography>No recent candidates</Typography> }
      { [...data.taps].reverse().map((event, index) => <Typography key={ index } variant="body2" sx={ { my: 1 } }>
        { event.origin }{ event.control ? ` (${event.control})` : '' }, { event.side ?? 'unknown side' }, count { event.count }, { event.source }
        <br />
        Event { new Date(event.timestamp * 1000).toISOString() }, received { new Date(event.receivedAt * 1000).toISOString() }
        <br />
        Sequence { event.sequence ?? 'unavailable' }, inner index { event.index }
      </Typography>) }
    </AccordionDetails>
  </Accordion>;
}
