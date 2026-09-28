import { useRef, useCallback, useEffect } from 'react';
import { palette } from '@design/tokens';
import { Button, Box } from '@mui/material';
import { Add, Remove } from '@mui/icons-material';
import { useControlTempStore } from './controlTempStore.tsx';
import { useAppStore } from '@state/appStore.tsx';
import { postDeviceStatus } from '@api/deviceStatus.ts';
import { useSettings } from '@api/settings.ts';
import { MIN_TEMP_F, MAX_TEMP_F, fahrenheitToLevel, levelToFahrenheit } from '@lib/temperatureConversions.ts';

type TemperatureButtonsProps = {
  refetch: any;
  currentTargetTemp: number;
}

const DEBOUNCE_MS = 400;
export default function TemperatureButtons({ refetch, currentTargetTemp }: TemperatureButtonsProps) {
  const { side, setIsUpdating } = useAppStore();
  const { deviceStatus, setDeviceStatus, beginEdit, endEdit } = useControlTempStore();
  const { data: settings } = useSettings();
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editOpenRef = useRef(false);
  const inFlight = useRef(false);
  const ready = useRef(false);
  const mounted = useRef(true);
  const savedTarget = useRef(currentTargetTemp);
  useEffect(() => {
    if (!editOpenRef.current && !inFlight.current) savedTarget.current = currentTargetTemp;
  }, [currentTargetTemp]);

  const postUpdate = useCallback(async () => {
    if (inFlight.current || !ready.current || !mounted.current) return;
    inFlight.current = true;
    ready.current = false;
    const target = useControlTempStore.getState().deviceStatus?.[side]?.targetTemperatureF;
    setIsUpdating(true);
    try {
      await postDeviceStatus({ [side]: { targetTemperatureF: target } });
      if (target !== undefined) savedTarget.current = target;
      await new Promise(resolve => setTimeout(resolve, 1500));
    } catch (error) {
      console.error(error);
      if (mounted.current && !ready.current && !debounceTimer.current) {
        setDeviceStatus({ [side]: { targetTemperatureF: savedTarget.current } });
      }
    } finally {
      inFlight.current = false;
      if (mounted.current && ready.current) {
        void postUpdate();
      } else if (!debounceTimer.current) {
        if (editOpenRef.current) {
          editOpenRef.current = false;
          endEdit();
        }
        if (mounted.current) await refetch?.();
        setIsUpdating(false);
      }
    }
  }, [side, refetch, setIsUpdating, endEdit, setDeviceStatus]);

  const scheduleUpdate = useCallback(() => {
    ready.current = false;
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      debounceTimer.current = null;
      ready.current = true;
      void postUpdate();
    }, DEBOUNCE_MS);
  }, [postUpdate]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
      if (!inFlight.current) setIsUpdating(false);
      if (editOpenRef.current) {
        editOpenRef.current = false;
        endEdit();
      }
    };
  }, [endEdit, setIsUpdating]);

  const isInAwayMode = settings?.[side].awayMode;
  if (isInAwayMode) return null;

  const disabled = isInAwayMode;
  const borderColor = palette.border.control;
  const iconColor = palette.lamp;

  // When the user is viewing in 'level' mode (-10..+10), one click should
  // change the displayed level by 1, which is 2.75F under the hood (the
  // scale spans 55..110F = 55F over 20 levels). Snap to the nearest integer
  // level so successive clicks stay on integer levels. In fahrenheit or
  // celsius mode a click is a plain 1F step.
  const isLevel = settings?.temperatureFormat === 'level';
  const handleClick = (direction: 1 | -1) => {
    if (!deviceStatus) return;
    const currentF = useControlTempStore.getState().deviceStatus![side].targetTemperatureF;
    const rawNextF = isLevel
      ? levelToFahrenheit(fahrenheitToLevel(currentF) + direction)
      : currentF + direction;
    // Clamp rapid taps to the supported range.
    const nextF = Math.min(MAX_TEMP_F, Math.max(MIN_TEMP_F, rawNextF));
    if (nextF === currentF) return;
    if (!editOpenRef.current) {
      editOpenRef.current = true;
      beginEdit();
    }
    setDeviceStatus({
      [side]: {
        targetTemperatureF: nextF,
      }
    });

    scheduleUpdate();
  };

  const buttonStyle = {
    borderWidth: '2px',
    borderColor,
    width: 64,
    height: 64,
    borderRadius: '50%',
    minWidth: 0,
    padding: 0,
  };

  return (
    <Box
      sx={ {
        position: 'relative',
        mt: -3,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        gap: '48px',
        width: '100%',
        marginLeft: 'auto',
        marginRight: 'auto',
      } }
    >
      <Button
        aria-label="Decrease temperature"
        variant="outlined"
        color="primary"
        sx={ buttonStyle }
        onClick={ () => handleClick(-1) }
        onKeyDown={ event => { if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') { event.preventDefault(); handleClick(-1); } } }
        disabled={ disabled || (deviceStatus?.[side]?.targetTemperatureF ?? MIN_TEMP_F) <= MIN_TEMP_F }
      >
        <Remove sx={ { color: iconColor } }/>
      </Button>
      <Button
        aria-label="Increase temperature"
        variant="outlined"
        sx={ buttonStyle }

        onClick={ () => handleClick(1) }
        onKeyDown={ event => { if (event.key === 'ArrowUp' || event.key === 'ArrowRight') { event.preventDefault(); handleClick(1); } } }
        disabled={ disabled || (deviceStatus?.[side]?.targetTemperatureF ?? MAX_TEMP_F) >= MAX_TEMP_F }
      >
        <Add sx={ { color: iconColor } }/>
      </Button>
    </Box>
  );
}
