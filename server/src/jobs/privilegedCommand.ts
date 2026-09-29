import { execFile } from 'child_process';

export class PrivilegedCommandError extends Error {}

function execute(file: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, [...args], { encoding: 'utf8', timeout: 30_000 }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

const OPERATION_UNITS = ['free-sleep-update.service', 'free-sleep-rollback.service', 'free-sleep-revert.service'];
let operationStarting = false;

export type StartHooks = {
  beforeStart?: () => Promise<void>;
  onStartFailure?: () => Promise<void>;
};

async function assertOperationsIdle() {
  for (const unit of OPERATION_UNITS) {
    let state: string;
    try {
      state = (await execute('/bin/systemctl', ['show', unit, '--property=ActiveState', '--value'])).trim();
    } catch {
      throw new PrivilegedCommandError('Cannot check running operations. Check the service logs before trying again.');
    }
    if (!['inactive', 'failed'].includes(state)) {
      throw new PrivilegedCommandError('An update, rollback or switch is already running. Wait for it to finish.');
    }
  }
}

async function startCommand(command: readonly string[], unit: string, operation: boolean, hooks: StartHooks) {
  try {
    const state = await execute('/bin/systemctl', ['show', unit, '--property=LoadState', '--value']);
    if (state.trim() !== 'loaded') throw new Error(`Unit is ${state.trim()}`);
    await execute('sudo', ['-n', '-l', '--', ...command]);
  } catch {
    throw new PrivilegedCommandError(`Cannot run ${unit}: its service or sudo permission is missing. `
      + 'A successful update repairs these rules and services.');
  }
  if (operation) await assertOperationsIdle();
  try {
    await hooks.beforeStart?.();
    await execute('sudo', ['-n', '--', ...command]);
  } catch {
    await hooks.onStartFailure?.();
    throw new PrivilegedCommandError(`Unable to start ${unit}. Check the service logs and try again.`);
  }
}

// A queued systemd start is fast, but its exit status still matters. Check
// both the unit and the exact sudo grant before reporting acceptance.
export async function runPrivilegedCommand(command: readonly string[], unit: string, hooks: StartHooks = {}): Promise<void> {
  const operation = OPERATION_UNITS.includes(unit);
  if (operation && operationStarting) {
    throw new PrivilegedCommandError('An update, rollback or switch is already running. Wait for it to finish.');
  }
  if (operation) operationStarting = true;
  try {
    await startCommand(command, unit, operation, hooks);
  } finally {
    if (operation) operationStarting = false;
  }
}
