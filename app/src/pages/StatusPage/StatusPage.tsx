import moment from 'moment-timezone';
import { Alert, AlertTitle, Button, CircularProgress, Typography } from '@mui/material';
import { useStatusSummary } from './useStatusSummary';
import { StatusInfo } from '@api/serverStatusSchema.ts';
import { SubpageShell } from '../DataPage/Header.tsx';
import GroupCard from './GroupCard.tsx';
import {
  GROUP_LABELS, STATUS_META, StatusGroup, waitingCoreKeys, statusName,
} from './statusMeta.ts';

const GROUPS: StatusGroup[] = ['core', 'schedules', 'biometrics'];

export default function StatusPage() {
  const { data, isLoading, isError, refetch, dataUpdatedAt, keys, coreReady, overdue, attention, now } = useStatusSummary();
  const waitingNames = waitingCoreKeys(data).map(key => statusName(key, data?.[key])).join(', ');
  const overdueNames = overdue.map(key => statusName(key, data?.[key])).join(', ');
  const stale = dataUpdatedAt > 0 && now - dataUpdatedAt > 60_000;
  const activity = keys.filter(key => ['started', 'waiting_for_data'].includes((data![key] as StatusInfo).status));

  const impact = attention.some(key => key === 'waterTank') ? 'Heating and cooling need water. Check the tank below.'
    : attention.some(key => key.startsWith('pumpHealth')) ? 'A pump may be stalled. Temperature readings may be inaccurate.'
      : attention.some(key => STATUS_META[key].group === 'schedules') ? 'Some scheduled changes may not run. Review the affected service below.'
        : attention.some(key => key === 'biometricsStream') ? 'Sleep tracking stopped. New sleep data may not be recorded.'
          : 'Review the affected service below for its impact and next step.';

  return (
    <SubpageShell title="System status" backTo="/settings/device" backLabel="Back to Pod and diagnostics">
      { isLoading && <CircularProgress aria-label="Loading system status" sx={ { mx: 'auto' } }/> }
      { (isError || stale) && (
        <Alert severity="warning" action={ <Button color="inherit" onClick={ () => void refetch() }>Check again</Button> }>
          Can't reach the Pod.{ dataUpdatedAt > 0
            ? ` Showing the last check at ${moment(dataUpdatedAt).format('h:mm A')}.` : ' No status check is available yet.' }
        </Alert>
      ) }
      { data && (
        <>
          { !isError && !stale && keys.length === 0 && <Alert severity="info">No status checks are available yet.</Alert> }
          { !isError && !stale && keys.length > 0 && <Alert severity={ attention.length ? 'warning' : coreReady ? 'success' : 'info' }>
            <AlertTitle>{ attention.length ? 'Some services need attention'
              : coreReady ? 'Everything is running' : 'Waiting for core services' }</AlertTitle>
            { !attention.length && !coreReady && <Typography variant="body2">Waiting for { waitingNames }.</Typography> }
            { overdue.length > 0 && <Typography variant="body2">
              { overdueNames } { overdue.length === 1 ? 'has' : 'have' } not started. Check the service below or open Logs.
            </Typography> }
            { attention.some(key => !overdue.includes(key)) && <Typography variant="body2">{ impact }</Typography> }
          </Alert> }
          <Typography variant="body2" color="text.secondary">
            { dataUpdatedAt > 0 && `Checked ${moment(dataUpdatedAt).format('h:mm A')}` }
            <Button onClick={ () => void refetch() }>Check again</Button>
          </Typography>
          { attention.length > 0 && <Typography variant="h2">Needs attention ({ attention.length })</Typography> }
          { [...GROUPS].sort((left, right) => {
            const rank = (group: StatusGroup) => attention.some(key => STATUS_META[key].group === group) ? 0
              : activity.some(key => STATUS_META[key].group === group) ? 1 : 2;
            return rank(left) - rank(right);
          }).map(group => (
            <GroupCard
              key={ group }
              label={ GROUP_LABELS[group] }
              keys={ keys.filter(key => STATUS_META[key].group === group) }
              data={ data }
              attentionKeys={ attention }
            />
          )) }
        </>
      ) }
    </SubpageShell>
  );
}
