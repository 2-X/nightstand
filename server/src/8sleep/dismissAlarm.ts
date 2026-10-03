import cbor from 'cbor';
import type { Side } from '../db/schedulesSchema.js';
import type { CommandOptions } from './frankenServer.js';
import { executeFunction } from './deviceApi.js';

// Replace a running alarm with a short one, then cancel any armed alarm.
export async function dismissAlarm(side: Side, options: CommandOptions = {}): Promise<void> {
  const command = side === 'left' ? 'ALARM_LEFT' : 'ALARM_RIGHT';
  await executeFunction(command, () => cbor.encode({
    pl: 1, du: 1, pi: 'double', tt: Math.floor(Date.now() / 1_000),
  }).toString('hex'), options);
  await executeFunction('ALARM_CLEAR', 'empty', options);
}
