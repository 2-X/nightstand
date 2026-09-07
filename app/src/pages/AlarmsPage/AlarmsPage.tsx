import { useState } from 'react';
import {
  Box, Button, Chip, IconButton, Switch, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditIcon from '@mui/icons-material/Edit';
import moment from 'moment-timezone';

import PageContainer from '../PageContainer.tsx';
import SideControl from '../../components/SideControl.tsx';
import AlarmEditorDialog from './AlarmEditorDialog.tsx';
import { cadenceLabel } from '../TonightPage/cadence.ts';
import { useAppStore } from '@state/appStore.tsx';
import { useRecurringAlarms, useSaveRecurringAlarms } from '@api/alarms.ts';
import type { RecurringAlarm } from '@api/schedulesSchema.ts';
import { palette } from '@design/tokens';

export default function AlarmsPage() {
  const { side } = useAppStore();
  const { data: alarmsBySide } = useRecurringAlarms();
  const save = useSaveRecurringAlarms();

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<RecurringAlarm | null>(null);

  const alarms = alarmsBySide?.[side] ?? [];

  const persist = (next: RecurringAlarm[]) => {
    save.mutate({ side, alarms: next });
  };

  const openNew = () => { setEditing(null); setEditorOpen(true); };
  const openEdit = (a: RecurringAlarm) => { setEditing(a); setEditorOpen(true); };

  const handleSave = (alarm: RecurringAlarm) => {
    const exists = alarms.some((a) => a.id === alarm.id);
    const next = exists ? alarms.map((a) => (a.id === alarm.id ? alarm : a)) : [...alarms, alarm];
    persist(next);
    setEditorOpen(false);
  };

  const toggleEnabled = (id: string) => {
    persist(alarms.map((a) => (a.id === id ? { ...a, enabled: !a.enabled } : a)));
  };

  const remove = (id: string) => {
    persist(alarms.filter((a) => a.id !== id));
  };

  return (
    <PageContainer sx={ { maxWidth: '600px', justifyContent: 'flex-start' } }>
      <Box sx={ { display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', px: 0.5, mt: 1 } }>
        <Typography sx={ { fontSize: '2rem', fontWeight: 600, letterSpacing: '-0.02em', color: palette.text.primary } }>
          Alarms
        </Typography>
        <Button startIcon={ <AddIcon/> } variant="outlined" onClick={ openNew } size="small">
          Add
        </Button>
      </Box>

      <Box sx={ { width: '100%' } }>
        { alarms.length === 0 ? (
          <Typography sx={ { fontSize: '0.95rem', color: palette.text.tertiary, py: 3, textAlign: 'center' } }>
            No alarms yet. Tap Add to create one.
          </Typography>
        ) : (
          alarms.map((a) => (
            <Box
              key={ a.id }
              sx={ {
                display: 'flex', alignItems: 'center', gap: 1.5, py: 1.5,
                borderTop: `1px solid ${palette.border.subtle}`,
                opacity: a.enabled ? 1 : 0.5,
              } }
            >
              <Box sx={ { flexGrow: 1 } }>
                <Typography sx={ { fontSize: '1.6rem', fontWeight: 500, color: palette.text.primary, fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 } }>
                  { moment(a.time, 'HH:mm').format('h:mm A') }
                </Typography>
                <Box sx={ { display: 'flex', gap: 0.75, mt: 0.5, alignItems: 'center', flexWrap: 'wrap' } }>
                  <Chip label={ cadenceLabel(a.recurrence) } size="small" variant="outlined"
                    sx={ { color: palette.text.secondary, borderColor: palette.border.medium } } />
                  { a.warmRampMinutes ? (
                    <Chip label={ `warm ${a.warmRampMinutes}m` } size="small" variant="outlined"
                      sx={ { color: palette.accent.orange, borderColor: palette.border.medium } } />
                  ) : null }
                  { a.smartWake?.enabled ? (
                    <Chip label={ `smart ${a.smartWake.windowMinutes}m` } size="small" variant="outlined"
                      sx={ { color: palette.accent.green, borderColor: palette.border.medium } } />
                  ) : null }
                </Box>
              </Box>
              <Switch checked={ a.enabled } onChange={ () => toggleEnabled(a.id) } />
              <IconButton aria-label="edit alarm" onClick={ () => openEdit(a) } size="small">
                <EditIcon fontSize="small" />
              </IconButton>
              <IconButton aria-label="delete alarm" onClick={ () => remove(a.id) } size="small">
                <DeleteOutlineIcon fontSize="small" />
              </IconButton>
            </Box>
          ))
        ) }
      </Box>

      <AlarmEditorDialog
        open={ editorOpen }
        initial={ editing }
        onCancel={ () => setEditorOpen(false) }
        onSave={ handleSave }
      />

      <SideControl showTemp={ false } />
    </PageContainer>
  );
}
