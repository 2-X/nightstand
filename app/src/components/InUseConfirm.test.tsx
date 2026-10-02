import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import InUseConfirm from './InUseConfirm';

const SIDE_ON = 'A side is on. The bed keeps its current temperature, but schedules and alarms stop for up to five minutes.';
const ALARM_SOON = 'An alarm is due in the next 15 minutes. If it falls while Nightstand restarts, it will not ring.';
const UNKNOWN = "Nightstand cannot read the bed's state right now, so someone may be using it.";

describe('InUseConfirm', () => {
  it.each([[[]], [undefined]])('renders nothing for %j', reasons => {
    const { container } = render(<InUseConfirm reasons={ reasons }/>);
    expect(container).toBeEmptyDOMElement();
  });

  it('says why in an alert', () => {
    render(<InUseConfirm reasons={ ['left-on', 'alarm-soon'] }/>);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(`${SIDE_ON}${ALARM_SOON}`);
  });

  it('says the state cannot be read', () => {
    render(<InUseConfirm reasons={ ['status-unknown'] }/>);
    expect(screen.getByRole('alert')).toHaveTextContent(UNKNOWN);
  });
});
