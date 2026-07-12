import {
  ToggleButtonGroup,
  ToggleButton,
} from '@mui/material';
import { useAppStore } from '@state/appStore.tsx';
import { useSettings } from '@api/settings.ts';
import { useDeviceStatus } from '@api/deviceStatus.ts';
import { formatTemperature } from '@lib/temperatureConversions.ts';

type SideControlProps = {
  showTemp?: boolean;
};

export default function SideControl({ showTemp }: SideControlProps) {
  const { side, setSide } = useAppStore();
  const { data: settings } = useSettings();
  const { data: deviceStatus } = useDeviceStatus();

  const format = settings?.temperatureFormat ?? 'fahrenheit';
  return (
    <ToggleButtonGroup
      color="primary"
      exclusive
      value={ side }
      onChange={ (event) => {
        // @ts-expect-error
        setSide(event.target.value);
      } }
      size="small"
    >
      <ToggleButton value="left" sx={ { p: 1 } }>
        { settings?.left?.name } &nbsp;
        { showTemp && side === 'right' && (

          deviceStatus?.left?.isOn ?

            formatTemperature(deviceStatus?.left?.targetTemperatureF, format)
            : 'Off'
        ) }
      </ToggleButton>
      <ToggleButton value="right">
        { settings?.right?.name } &nbsp;
        { showTemp && side === 'left' && (

          deviceStatus?.right?.isOn ?
            formatTemperature(deviceStatus?.right?.targetTemperatureF, format) : 'Off'

        ) }

      </ToggleButton>
    </ToggleButtonGroup>

  );
}
