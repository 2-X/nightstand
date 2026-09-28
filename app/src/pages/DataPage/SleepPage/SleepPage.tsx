/* eslint-disable react/no-multi-comp */
import { useMemo, useState } from 'react';
import moment from 'moment-timezone';
import { useSearchParams } from 'react-router-dom';
import NavigateBeforeIcon from '@mui/icons-material/NavigateBefore';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import {
  Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button,
  CircularProgress, IconButton, Tab, Tabs, Typography,
} from '@mui/material';
import VitalsLineChart from '@components/VitalsLineChart';
import SleepStagesCard from '@components/SleepStagesCard';
import SleepBalanceCard from '@components/SleepBalanceCard';
import SleepFitnessCard from '@components/SleepFitnessCard';
import SleepConsistencyCard from '@components/SleepConsistencyCard';
import SideControl from '@components/SideControl';
import ErrorBoundary from '@components/ErrorBoundary';
import { useAppStore, Side } from '@state/appStore';
import { useSleepRecords } from '@api/sleep';
import { useSettings } from '@api/settings';
import { useServices } from '@api/services';
import { useVitalsRecords, useVitalsSummary } from '@api/vitals';
import type { SleepRecord } from '@api/sleepSchema';
import type { VitalsMetric } from '@lib/vitalsPoints';
import { vitalsRecordsToPoints } from '@lib/vitalsPoints';
import PageContainer from '../../PageContainer';
import WeekStrip from './WeekStrip';
import WeeklyScheduleBars from './WeeklyScheduleBars';
import { recordForNight, recordsInWeek } from './sleepContext';
import MissingNightCard, { MissingNightState } from './MissingNightCard';
import useAnalyzeSleep from '@lib/useAnalyzeSleep';
import { SLEEP_ANALYSIS_HOUR, SLEEP_ANALYSIS_MINUTE } from '../../../../../server/src/sleepAnalysisSchedule';

const METRICS = [
  { key: 'heart_rate', label: 'Heart rate', unit: 'bpm', summary: 'avgHeartRate' },
  { key: 'breathing_rate', label: 'Breathing rate', unit: 'breaths/min', summary: 'avgBreathingRate' },
  { key: 'hrv', label: 'HRV', unit: 'ms', summary: 'avgHRV' },
] as const;

function NightVitals({ record, side, timeZone }: { record: SleepRecord; side: Side; timeZone: string }) {
  const [params, setParams] = useSearchParams();
  const metric = params.get('metric');
  const query = { side, startTime: record.entered_bed_at, endTime: record.left_bed_at };
  const { data: vitals, isPending, isError, refetch } = useVitalsRecords(query);
  const { data: weekSummary } = useVitalsSummary({
    side, startTime: moment.tz(record.left_bed_at, timeZone).subtract(7, 'days').toISOString(), endTime: record.left_bed_at,
  });
  const selectMetric = (next: VitalsMetric, expanded: boolean) => {
    const nextParams = new URLSearchParams(params);
    if (expanded) nextParams.set('metric', next);
    else nextParams.delete('metric');
    setParams(nextParams, { replace: true });
  };
  return (
    <Box sx={ { minWidth: 0 } }>
      <Typography component="h2" variant="h6" sx={ { mb: 1 } }>Night measurements</Typography>
      { METRICS.map(item => {
        const points = vitalsRecordsToPoints(vitals ?? [], item.key);
        const value = points.length ? points.reduce((sum, point) => sum + point.value, 0) / points.length : undefined;
        return (
          <Accordion
            key={ item.key }
            expanded={ metric === item.key }
            onChange={ (_, expanded) => selectMetric(item.key, expanded) }
            slotProps={ { transition: { mountOnEnter: true, unmountOnExit: true } } }
            disableGutters>
            <AccordionSummary expandIcon={ <ExpandMoreIcon/> } id={ `metric-${item.key}` } aria-controls={ `detail-${item.key}` }>
              <Box sx={ { display: 'flex', justifyContent: 'space-between', width: '100%', gap: 1 } }>
                <Typography>{ item.label }</Typography>
                <Typography color="text.secondary" variant="body2">
                  { Number.isFinite(value) && value! > 0 ? `${Math.round(value!)} ${item.unit}` : 'No estimate' }
                </Typography>
              </Box>
            </AccordionSummary>
            <AccordionDetails>
              <ErrorBoundary componentName={ item.label }>
                { isPending ? <CircularProgress size={ 24 } aria-label="Loading measurements"/> : isError ? (
                  <Alert severity="error" action={ <Button onClick={ () => refetch() }>Retry</Button> }>Measurements could not be loaded.</Alert>
                ) : vitalsRecordsToPoints(vitals ?? [], item.key).length ? (
                  <VitalsLineChart
                    vitalsRecords={ vitals }
                    metric={ item.key }
                    sevenDayAvg={ weekSummary?.[item.summary] }
                    timeZone={ timeZone }/>
                ) : <Typography color="text.secondary">No { item.label.toLowerCase() } estimate for this recording.</Typography> }
              </ErrorBoundary>
            </AccordionDetails>
          </Accordion>
        );
      }) }
    </Box>
  );
}

// Keep explicit date selection across side changes.
function SleepContext({ side, timeZone, sleeper }: { side: Side; timeZone: string; sleeper: string }) {
  const [weekDate, setWeekDate] = useState<string>();
  const [chosenDate, setChosenDate] = useState<string>();
  const [view, setView] = useState('night');
  const { data, isPending, isError, refetch } = useSleepRecords({ side });
  const sideRecords = isError ? [] : data?.filter(record => record.side === side) ?? [];
  const newest = [...sideRecords].sort((left, right) => Date.parse(right.left_bed_at) - Date.parse(left.left_bed_at))[0];
  const { data: services } = useServices();
  const job = services?.biometrics.jobs?.[side === 'left' ? 'analyzeSleepLeft' : 'analyzeSleepRight'];
  const analysis = useAnalyzeSleep();
  const today = moment.tz(timeZone);
  const todayDate = today.format('YYYY-MM-DD');
  const latestMissing = !recordForNight(sideRecords, todayDate, timeZone);
  const jobIsToday = !!job?.timestamp && moment.tz(job.timestamp, timeZone).isSame(today, 'day');
  const analysisTime = today.clone().startOf('day').hour(SLEEP_ANALYSIS_HOUR).minute(SLEEP_ANALYSIS_MINUTE);
  const currentState: MissingNightState = services?.biometrics.enabled === false ? 'off'
    : analysis.isPending ? 'analyzing'
      : analysis.error || (job?.status === 'failed' && jobIsToday) ? 'failed'
        : (today.isBefore(analysisTime) && !jobIsToday) || job?.status === 'not_started'
          || (job?.status === 'waiting_for_data' && !jobIsToday) ? 'pending' : 'empty';
  const completedToday = jobIsToday && (job?.status === 'healthy' || job?.status === 'waiting_for_data');
  const showLatestAnalysis = !chosenDate && !weekDate && latestMissing
    && ((completedToday && currentState === 'empty')
      || (newest?.sleep_period_seconds !== 0 && ['pending', 'analyzing', 'failed'].includes(currentState)));
  const initialWeek = moment.tz(showLatestAnalysis ? todayDate : newest?.left_bed_at, timeZone).startOf('isoWeek').format('YYYY-MM-DD');
  const weekStart = useMemo(() => moment.tz(weekDate ?? initialWeek, timeZone).startOf('day'), [weekDate, initialWeek, timeZone]);
  const weekEnd = weekStart.clone().add(6, 'days');
  const weekTitle = `${weekStart.format('MMM D')} - ${weekEnd.format('MMM D')}`;
  const records = isError ? [] : recordsInWeek(sideRecords, weekStart, timeZone);
  const latest = [...records].sort((left, right) => Date.parse(right.left_bed_at) - Date.parse(left.left_bed_at))[0];
  const defaultDate = latest ? moment.tz(latest.left_bed_at, timeZone) : moment.min(today, weekEnd);
  const selectedDate = chosenDate ?? (showLatestAnalysis ? todayDate : defaultDate.format('YYYY-MM-DD'));
  const selected = recordForNight(records, selectedDate, timeZone);
  const isLatestDate = selectedDate === todayDate;
  const missingState: MissingNightState = selected?.sleep_period_seconds === 0 ? 'zero'
    : services?.biometrics.enabled === false ? 'off' : isLatestDate ? currentState : 'empty';
  const fallback = !selected && isLatestDate
    && (['pending', 'analyzing', 'failed'].includes(missingState) || (missingState === 'empty' && completedToday)) ? newest : undefined;
  const displayed = selected?.sleep_period_seconds === 0 ? undefined : selected ?? fallback;
  const nightTitle = (wakeDate: string) => moment.tz(wakeDate, timeZone).format('[Woke] ddd, MMM D');
  const phoneZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const podZoneLabel = timeZone.split('/').slice(-1)[0]?.replace(/_/g, ' ') ?? timeZone;
  const changeWeek = (amount: number) => {
    setWeekDate(weekStart.clone().add(amount, 'week').format('YYYY-MM-DD'));
    setChosenDate(undefined);
  };

  return (
    <>
      <Box sx={ { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } }>
        <IconButton aria-label="Previous week" onClick={ () => changeWeek(-1) }><NavigateBeforeIcon/></IconButton>
        <Typography>{ weekTitle }</Typography>
        <IconButton
          aria-label="Next week"
          disabled={ weekStart.isSameOrAfter(moment.tz(timeZone).startOf('isoWeek')) }
          onClick={ () => changeWeek(1) }><NavigateNextIcon/></IconButton>
      </Box>
      <WeekStrip
        weekStart={ weekStart }
        timeZone={ timeZone }
        selectedDate={ selectedDate }
        records={ records }
        currentNightState={ currentState }
        onSelectDay={ date => {
          setChosenDate(date);
          setWeekDate(weekStart.format('YYYY-MM-DD'));
        } }/>
      <Tabs value={ view } onChange={ (_, next: string) => setView(next) } aria-label="Sleep period" variant="fullWidth">
        <Tab value="night" label="Night" id="sleep-night" aria-controls="sleep-panel"/>
        <Tab value="week" label="Week" id="sleep-week" aria-controls="sleep-panel"/>
      </Tabs>
      <Box>
        <Typography component="h2" variant="h6">{ view === 'week' ? weekTitle : nightTitle(selectedDate) }</Typography>
        <Typography variant="body2" color="text.secondary">{ sleeper } · Dates show when you woke</Typography>
        { phoneZone !== timeZone && (
          <Typography variant="body2" color="text.secondary">Times shown in Pod time ({ podZoneLabel })</Typography>
        ) }
      </Box>
      <Box role="tabpanel" id="sleep-panel" aria-labelledby={ `sleep-${view}` }>
        { isPending ? <CircularProgress aria-label="Loading sleep records"/> : isError ? (
          <Alert severity="error" action={ <Button onClick={ () => refetch() }>Retry</Button> }>Sleep records could not be loaded.</Alert>
        ) : view === 'week' ? (
          <Box sx={ { display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } } }>
            <ErrorBoundary componentName="Sleep balance">
              <SleepBalanceCard records={ records } weekStart={ weekStart } timeZone={ timeZone }/>
            </ErrorBoundary>
            <ErrorBoundary componentName="Sleep consistency">
              <SleepConsistencyCard weekRecords={ records } weekStart={ weekStart } timeZone={ timeZone }/>
            </ErrorBoundary>
            <ErrorBoundary componentName="Weekly schedule">
              <WeeklyScheduleBars records={ records } weekStart={ weekStart } timeZone={ timeZone }/>
            </ErrorBoundary>
          </Box>
        ) : (
          <>
            { (!selected || selected.sleep_period_seconds === 0 || services?.biometrics.enabled === false) && (
              <MissingNightCard
                state={ missingState }
                canAnalyze={ analysis.canAnalyze }
                onAnalyze={ () => void analysis.analyze() }/>
            ) }
            { fallback && displayed && (
              <Box sx={ { mb: 2 } }>
                <Typography variant="body2" color="text.secondary">Most recent recording</Typography>
                <Typography component="h2" variant="h6">
                  { nightTitle(moment.tz(displayed.left_bed_at, timeZone).format('YYYY-MM-DD')) }
                </Typography>
              </Box>
            ) }
            { displayed && (
              <Box
                sx={ {
                  display: 'grid', gap: 2, alignItems: 'start',
                  gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1.1fr) minmax(0, 1fr)' },
                } }>
                <Box sx={ { display: 'grid', gap: 2, minWidth: 0 } }>
                  <ErrorBoundary componentName="Night summary">
                    <SleepFitnessCard sleepRecord={ displayed } timeZone={ timeZone }/>
                  </ErrorBoundary>
                  <ErrorBoundary componentName="Sleep stages">
                    <SleepStagesCard startTime={ displayed.entered_bed_at } endTime={ displayed.left_bed_at } timeZone={ timeZone }/>
                  </ErrorBoundary>
                </Box>
                <ErrorBoundary key={ `${side}-${displayed.id}` } componentName="Night measurements">
                  <NightVitals record={ displayed } side={ side } timeZone={ timeZone }/>
                </ErrorBoundary>
              </Box>
            ) }
          </>
        ) }
      </Box>
    </>
  );
}

export default function SleepPage() {
  const { side } = useAppStore();
  const { data: settings, isError, refetch } = useSettings();
  return (
    <ErrorBoundary componentName="Sleep page">
      <PageContainer sx={ { mb: 12, gap: 2, alignItems: 'stretch' } }>
        <Typography component="h1" variant="h1">Sleep</Typography>
        <SideControl mergeAwaySides={ false }/>
        { isError ? (
          <Alert severity="error" action={ <Button onClick={ () => refetch() }>Retry</Button> }>Pod settings could not be loaded.</Alert>
        ) : settings ? (
          <SleepContext
            key={ settings.timeZone }
            side={ side }
            timeZone={ settings.timeZone }
            sleeper={ settings[side].name || `${side === 'left' ? 'Left' : 'Right'} side` }/>
        ) : <CircularProgress aria-label="Loading Pod timezone"/> }
      </PageContainer>
    </ErrorBoundary>
  );
}
