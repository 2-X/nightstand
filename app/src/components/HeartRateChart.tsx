import { LineChart } from '@mui/x-charts/LineChart';
import { Card, Typography } from '@mui/material';
import moment from 'moment-timezone';
import { useVitalsRecords } from '@api/vitals.ts';
import { useAppStore } from '@state/appStore.tsx';
import { useTheme } from '@mui/material/styles';
import { VitalsRecord } from '@api/vitals.ts';
import { useResizeDetector } from 'react-resize-detector';


type HeartRateChartProps = {
  startTime: string;
  endTime: string;
};

const downsampleData = (data: VitalsRecord[], factor: number) => {
  return data.filter((_, index) => index % factor === 0);
};

export default function HeartRateChart({ startTime, endTime }: HeartRateChartProps) {
  const { width = 300, ref } = useResizeDetector();

  const { side } = useAppStore();
  const theme = useTheme();

  const { data: vitalsRecords } = useVitalsRecords({
    side,
    startTime: startTime,
    endTime: endTime
  });

  if (!vitalsRecords) return;
  const pxPerPoint = 3;
  const allowedPoints = width / pxPerPoint;
  const downsampleTo = Math.ceil(vitalsRecords.length / allowedPoints);

  const cleanedVitalsRecords = downsampleData(vitalsRecords, downsampleTo)
    .filter(
      (record) =>
        record.period_start &&
        !isNaN(new Date(record.period_start).getTime()) &&
        !isNaN(record.heart_rate)
    )
    .map((record) => ({
      ...record,
      period_start: new Date(record.period_start), // Convert to Date object
      heart_rate: Number(record.heart_rate), // Ensure it's a number
    }));

  return (
    <Card sx={ { pt: 1, mt: 2, pl: 2 } }>
      <Typography variant="h6" gutterBottom>
        Heart Rate
      </Typography>
      <LineChart
        ref={ ref }
        height={ 300 }
        colors={ [theme.palette.error.main] }
        dataset={ cleanedVitalsRecords }
        xAxis={ [
          {
            id: 'Years',
            dataKey: 'period_start',
            scaleType: 'time',
            valueFormatter: (periodStart) =>
              moment(periodStart).tz('America/Chicago').format('HH:mm'),
          },
        ] }
        legend={ { hidden: true } }
        series={ [
          {
            id: 'Heart Rate',
            label: 'Heart Rate',
            dataKey: 'heart_rate',
            valueFormatter: (heartRate) => (heartRate !== null && !isNaN(heartRate) ? heartRate.toFixed(0) : 'Invalid'),
            showMark: false,
          },
        ] }
      />
    </Card>
  );
}
