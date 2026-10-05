import express, { Request, Response } from 'express';
import { frankenCommands, executeFunction } from '../../8sleep/deviceApi.js';
import { normalizeExecuteArg } from './executeHelpers.js';

import { noteManualPowerChange } from '../../jobs/manualPowerChange.js';

const router = express.Router();

router.post('/execute', async (req: Request, res: Response) => {
  const { command, arg } = (req.body ?? {}) as { command?: unknown; arg?: unknown };

  // Basic validation
  if (typeof command !== 'string' || !Object.hasOwn(frankenCommands, command)) {
    res.status(400).json({ message: 'Invalid command' });
    return;
  }

  const normalizedArg = normalizeExecuteArg(command, arg);
  if (normalizedArg === undefined) {
    res.status(400).json({ message: `Invalid arg for ${command}` });
    return;
  }

  if (command === 'LEFT_TEMP_DURATION') noteManualPowerChange('left');
  if (command === 'RIGHT_TEMP_DURATION') noteManualPowerChange('right');

  // Execute the 8sleep command
  await executeFunction(command as keyof typeof frankenCommands, normalizedArg);

  // Respond with success
  res.json({ success: true, message: `Command '${command}' executed successfully.` });
  return;
});

export default router;
