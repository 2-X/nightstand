import { it } from 'node:test';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
it('preserves SQLite backups, shutdown data, and shipped migration checksums', () => {
    execFileSync('python3', ['-m', 'unittest', 'discover', '-s', 'scripts/tests', '-v'], {
        cwd: path.resolve(import.meta.dirname, '../../..'),
        timeout: 60_000,
        stdio: 'pipe',
    });
});
//# sourceMappingURL=sqliteSafety.test.js.map