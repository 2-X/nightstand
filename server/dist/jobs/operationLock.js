import { spawn } from 'child_process';
import logger from '../logger.js';
import { OperationBusyError, OperationCheckError } from './privilegedCommand.js';
const LOCK_SCRIPT = `
import fcntl, os, sys
default = '/run/lock/free-sleep-operation.lock' if os.path.isdir('/run/lock') else '/tmp/free-sleep-operation.lock'
path = os.environ.get('NIGHTSTAND_OPERATION_LOCK') or default
try:
    handle = open(path, 'r')
except FileNotFoundError:
    sys.exit(76)
try:
    fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
except BlockingIOError:
    sys.exit(75)
print('locked', flush=True)
sys.stdin.read()
`;
let missingLogged = false;
// Keep the script lock held across the asynchronous reads and service command.
export async function withOperationLock(operation) {
    const holder = spawn('python3', ['-c', LOCK_SCRIPT], { stdio: ['pipe', 'pipe', 'pipe'] });
    const closed = new Promise(resolve => holder.once('close', () => resolve()));
    try {
        const locked = await new Promise((resolve, reject) => {
            holder.once('error', () => reject(new OperationCheckError('Cannot take the operation lock.')));
            holder.once('close', code => {
                if (code === 76)
                    resolve(false);
                else
                    reject(code === 75
                        ? new OperationBusyError('An update, rollback, switch, install or reset is already running. Wait for it to finish.')
                        : new OperationCheckError('Cannot take the operation lock.'));
            });
            holder.stdout.once('data', data => {
                if (data.toString().trim() === 'locked')
                    resolve(true);
                else
                    reject(new OperationCheckError('Cannot take the operation lock.'));
            });
        });
        if (!locked) {
            if (!missingLogged) {
                missingLogged = true;
                logger.warn('Operation lock is missing. Biometrics reconciliation will retry on the next trigger.');
            }
            return;
        }
        return await operation();
    }
    finally {
        holder.stdin.end();
        await closed;
    }
}
//# sourceMappingURL=operationLock.js.map