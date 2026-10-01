import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import moment from 'moment-timezone';
import { Box, Button, ButtonBase, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Typography } from '@mui/material';
import ChevronLeft from '@mui/icons-material/ChevronLeft';
import ChevronRight from '@mui/icons-material/ChevronRight';
import type { SideRhythms } from '@api/rhythmsSchema';
import { palette } from '@design/tokens';
import { changeFor, formatDate, MAX_CHANGE_DAYS_AHEAD } from './rhythmsModel';

const DATE = 'YYYY-MM-DD';
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

type Props = { sideData: SideRhythms; today: string; onNext: (dates: string[]) => void; onClose: () => void };

// For irregular weeks: tap every date that should share a rhythm, then choose it once.
export default function MultiDateSheet({ sideData, today, onNext, onClose }: Props) {
  const titleId = useId();
  const monthId = useId();
  const last = moment(today, DATE).add(MAX_CHANGE_DAYS_AHEAD, 'days').format(DATE);
  const [month, setMonth] = useState(() => moment(today, DATE).startOf('month'));
  const [chosen, setChosen] = useState<string[]>([]);
  const [focusDate, setFocusDate] = useState(today);
  const grid = useRef<HTMLDivElement>(null);
  // Arrow keys can cross into another month, so focus waits for that month to render.
  const pendingFocus = useRef<string | undefined>(undefined);
  useEffect(() => {
    const date = pendingFocus.current;
    if (!date) return;
    pendingFocus.current = undefined;
    grid.current?.querySelector<HTMLElement>(`[data-date="${date}"]`)?.focus();
  });
  const firstMonth = moment(today, DATE).startOf('month');
  const lastMonth = moment(last, DATE).startOf('month');
  const cells = Array.from({ length: month.day() }, () => null as string | null)
    .concat(Array.from({ length: month.daysInMonth() }, (_, index) => month.clone().date(index + 1).format(DATE)));
  const inRange = (date: string) => date >= today && date <= last;
  const toggle = (date: string) => setChosen(previous => previous.includes(date)
    ? previous.filter(item => item !== date) : [...previous, date].sort());
  const moveFocus = (date: string) => {
    if (!inRange(date)) return;
    const target = moment(date, DATE).startOf('month');
    if (!target.isSame(month)) setMonth(target);
    pendingFocus.current = date;
    setFocusDate(date);
  };
  const onKey = (event: KeyboardEvent, date: string) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    moveFocus(moment(date, DATE).add(step, 'days').format(DATE));
  };
  const tabDate = cells.includes(focusDate) ? focusDate : cells.find(date => date && inRange(date)) ?? '';
  return <Dialog
    open
    onClose={ onClose }
    aria-labelledby={ titleId }
    fullWidth
    maxWidth="sm"
    sx={ { '& .MuiDialog-container': { alignItems: 'flex-end' },
      '& .MuiDialog-paper': { m: 0, width: '100%', borderRadius: '20px 20px 0 0' } } }>
    <DialogTitle id={ titleId }>Change several dates</DialogTitle>
    <DialogContent sx={ { px: { xs: 0.75, sm: 3 } } }>
      <Typography variant="body2" color="text.secondary" sx={ { px: { xs: 1.25, sm: 0 }, mb: 1 } }>
        Tap each date that should use the same rhythm, up to { MAX_CHANGE_DAYS_AHEAD } days ahead.
      </Typography>
      <Box sx={ { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } }>
        <IconButton
          aria-label="Previous month"
          disabled={ !month.isAfter(firstMonth) }
          onClick={ () => setMonth(month.clone().subtract(1, 'month')) }
          sx={ { width: 44, height: 44 } }><ChevronLeft/></IconButton>
        <Typography id={ monthId } aria-live="polite" sx={ { fontWeight: 600 } }>{ month.format('MMMM YYYY') }</Typography>
        <IconButton
          aria-label="Next month"
          disabled={ !month.isBefore(lastMonth) }
          onClick={ () => setMonth(month.clone().add(1, 'month')) }
          sx={ { width: 44, height: 44 } }><ChevronRight/></IconButton>
      </Box>
      <Box
        ref={ grid }
        role="group"
        aria-labelledby={ monthId }
        sx={ { display: 'grid', gridTemplateColumns: 'repeat(7, minmax(44px, 1fr))', rowGap: 0.5 } }>
        { WEEKDAYS.map(day => <Typography
          key={ day }
          aria-hidden
          variant="caption"
          color="text.secondary"
          sx={ { textAlign: 'center', py: 0.5 } }>{ day }</Typography>) }
        { cells.map((date, index) => {
          if (!date) return <Box key={ `blank-${index}` }/>;
          const on = chosen.includes(date);
          const usable = inRange(date);
          const changed = !!changeFor(sideData, date);
          return <ButtonBase
            key={ date }
            data-date={ date }
            disabled={ !usable }
            aria-pressed={ on }
            aria-current={ date === today ? 'date' : undefined }
            aria-label={ `${formatDate(date)}${changed ? ', changed' : ''}` }
            tabIndex={ date === tabDate ? 0 : -1 }
            onClick={ () => {
              toggle(date);
              setFocusDate(date);
            } }
            onKeyDown={ event => onKey(event, date) }
            sx={ {
              minHeight: 44, minWidth: 44, borderRadius: '12px', fontSize: 15, position: 'relative',
              color: !usable ? 'text.disabled' : on ? palette.bg.base : 'text.primary',
              bgcolor: on ? palette.lamp : 'transparent',
              border: date === today ? `1px solid ${palette.border.control}` : '1px solid transparent',
              '&.Mui-focusVisible': { outline: `2px solid ${palette.lamp}`, outlineOffset: 1 },
            } }>
            { moment(date, DATE).date() }
            { changed && <Box
              aria-hidden
              sx={ { position: 'absolute', bottom: 5, width: 4, height: 4, borderRadius: '50%',
                bgcolor: on ? palette.bg.base : palette.text.secondary } }/> }
          </ButtonBase>;
        }) }
      </Box>
      <Typography role="status" variant="body2" sx={ { px: { xs: 1.25, sm: 0 }, mt: 1 } }>
        { chosen.length ? `${chosen.length} ${chosen.length === 1 ? 'date' : 'dates'} selected` : 'No dates selected' }
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={ { display: 'block', px: { xs: 1.25, sm: 0 } } }>
        A dot marks a date that is already changed.
      </Typography>
    </DialogContent>
    <DialogActions>
      <Button onClick={ onClose }>Cancel</Button>
      <Button variant="contained" disabled={ !chosen.length } onClick={ () => onNext(chosen) }>Choose a rhythm</Button>
    </DialogActions>
  </Dialog>;
}
