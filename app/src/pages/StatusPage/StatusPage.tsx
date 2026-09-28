import moment from 'moment-timezone';
import { Alert, Box, Button, CircularProgress, Typography } from '@mui/material';
import { useServerStatus } from '@api/serverStatus.ts';
import { ServerStatusKey, StatusInfo } from '@api/serverStatusSchema.ts';
import { Link } from 'react-router-dom';
import PageContainer from '../PageContainer.tsx';
import GroupCard from './GroupCard.tsx';
import { GROUP_LABELS, STATUS_META, StatusGroup, needsAttention } from './statusMeta.ts';

const GROUPS: StatusGroup[] = ['schedules', 'biometrics', 'core'];

export default function StatusPage() {
  const { data, isLoading, isError, refetch, dataUpdatedAt } = useServerStatus(30_000);
  const keys = data ? (Object.keys(data) as ServerStatusKey[]).filter(key => !!data[key]) : [];
  const attention = keys.filter(key => needsAttention((data![key] as StatusInfo).status));
  const activity = keys.filter(key => ['started', 'waiting_for_data'].includes((data![key] as StatusInfo).status));

  return (
    <PageContainer sx={ { mb: 15, pt: 3, gap: 2, alignItems: 'stretch' } }>
      <Button component={ Link } to="/settings/device" sx={ { alignSelf: 'flex-start' } }>Back to Device</Button>
      <Box>
        <Typography variant="h5" component="h1">System</Typography>
        { dataUpdatedAt > 0 && (
          <Typography variant="caption" color="text.secondary">
            { isError ? 'Last received' : 'Updated' } { moment(dataUpdatedAt).format('h:mm:ss A') }
          </Typography>
        ) }
      </Box>
      { isLoading && <CircularProgress aria-label="Loading system status" sx={ { mx: 'auto' } }/> }
      { isError && (
        <Alert severity="error" action={ <Button color="inherit" onClick={ () => void refetch() }>Retry</Button> }>
          { data ? 'Could not refresh system status. These are the last received readings.' : 'Could not load system status.' }
        </Alert>
      ) }
      { data && (
        <>
          <Typography variant="body2">
            { attention.length > 0
              ? `${attention.length} ${attention.length === 1 ? 'item needs' : 'items need'} attention`
              : 'No reported service errors' }
            { activity.length > 0 ? `; ${activity.length} collecting data or running.` : '.' }
          </Typography>
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
            />
          )) }
        </>
      ) }
    </PageContainer>
  );
}
