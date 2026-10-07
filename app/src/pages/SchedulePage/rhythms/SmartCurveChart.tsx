/* eslint-disable react/no-multi-comp */
// The band is private to this chart and needs the chart's scale.
import { useMemo } from 'react';
import moment from 'moment-timezone';
import { Box, Paper, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { LineChart, areaElementClasses, lineElementClasses } from '@mui/x-charts/LineChart';
import { useDrawingArea, useXScale } from '@mui/x-charts/hooks';
import type { DailySchedule } from '@api/schedulesSchema';
import type { SmartSchedule } from '@api/rhythmsSchema';
import { curveBounds } from '@api/smartCurve';
import {
  fahrenheitToDisplay, formatDisplayValue, formatTemperature, levelToFahrenheit, type TemperatureFormat,
} from '@lib/temperatureConversions';
import { palette } from '@design/tokens';
import { CHART_END_PADDING_MS, HorizontalTempGradient, type Point } from '../ScheduleChart';
import { curveSummary, previewCurves } from './smartPreview';
import { PRESENCE_NOTE } from './presenceNote';

function CoolDownBand({ from, to }: { from: Date; to: Date }) {
  const { top, height } = useDrawingArea();
  const xScale = useXScale<'time'>();
  const start = xScale(from);
  const end = xScale(to);
  return <rect
    data-testid="cool-down-band"
    x={ Math.min(start, end) }
    y={ top }
    width={ Math.abs(end - start) }
    height={ height }
    fill={ palette.text.secondary }
    opacity={ 0.14 }/>;
}

type Props = {
  night: DailySchedule;
  wake: string;
  smart: SmartSchedule;
  date: string;
  timeZone: string;
  format: TemperatureFormat;
  trackingOn: boolean;
};

export default function SmartCurveChart({ night, wake, smart, date, timeZone, format, trackingOn }: Props) {
  const theme = useTheme();
  const preview = useMemo(() => previewCurves({ night, wake, smart, date, timeZone, trackingOn }),
    [night, wake, smart, date, timeZone, trackingOn]);
  // Scaled to the curve, one step past its bounds, so a few steps read as a curve and not a flat line.
  const bounds = curveBounds(smart.baseLevel);
  const display = (level: number) => fahrenheitToDisplay(levelToFahrenheit(level), format);
  const min = display(Math.max(-10, bounds.min - 1));
  const max = display(Math.min(10, bounds.max + 1));
  const points: Point[] = preview.series.map(point => ({
    x: point.at,
    y: Math.min(max, Math.max(min, display(point.level))),
    temperature: levelToFahrenheit(point.level),
    rowId: '',
  }));
  if (points.length < 2) return null;
  const axisColor = theme.palette.text.secondary;
  const summary = curveSummary(preview.points, level => formatTemperature(levelToFahrenheit(level), format), preview.anchors);
  const { bedtime, wake: wakeAt } = preview.markers;
  return <Paper variant="outlined" role="figure" aria-label={ `Smart Schedule preview: ${summary}` } sx={ { width: '100%', p: 2 } }>
    <Box aria-hidden>
      <LineChart
        height={ 120 }
        xAxis={ [{
          scaleType: 'time',
          data: points.map(point => point.x),
          min: preview.domain.from,
          max: new Date(preview.domain.to.getTime() + CHART_END_PADDING_MS),
          tickInterval: [bedtime, wakeAt],
          tickLabelStyle: { fill: axisColor },
          valueFormatter: (value, context) => context.location === 'tick'
            ? (value as Date).getTime() === bedtime.getTime() ? 'Bedtime' : 'Wake'
            : moment(value as Date).tz(timeZone).format('h:mm A'),
        }] }
        yAxis={ [{
          min, max, tickNumber: 3, tickLabelStyle: { fill: axisColor }, valueFormatter: (value: number) => formatDisplayValue(value, format),
        }] }
        series={ [{
          id: 'smart-curve',
          label: 'Smart Schedule',
          data: points.map(point => point.y),
          area: true,
          baseline: min,
          showMark: false,
          curve: 'stepAfter',
        }] }
        margin={ { right: 32, left: 36, top: 5, bottom: 24 } }
        sx={ {
          [`& .${lineElementClasses.root}`]: { stroke: 'url(#smart-grad-line)' },
          [`& .${areaElementClasses.root}`]: { fill: 'url(#smart-grad-area)', filter: 'none' },
        } }
        slotProps={ { legend: { hidden: true } } }>
        { preview.band && <CoolDownBand from={ preview.band.from } to={ preview.band.to }/> }
        <HorizontalTempGradient idArea="smart-grad-area" idLine="smart-grad-line" points={ points }/>
      </LineChart>
    </Box>
    { summary && <Typography variant="body2" sx={ { mt: 1 } }>
      { summary }
    </Typography> }
    <Typography variant="caption" color="text.secondary" sx={ { display: 'block', mt: 0.5 } }>
      { trackingOn ? 'Shaded: the cool-down can start up to 2 hours later, once you\'ve settled in bed.'
        : 'Follows the clock from bedtime to wake-up.' }
    </Typography>
    { trackingOn && <Typography variant="caption" color="text.secondary" sx={ { display: 'block', mt: 0.5 } }>
      { PRESENCE_NOTE }
    </Typography> }
  </Paper>;
}
