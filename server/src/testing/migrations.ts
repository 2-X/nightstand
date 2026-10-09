import { readFileSync } from 'node:fs';
import path from 'node:path';

type RawClient = { $executeRawUnsafe(query: string): Promise<unknown> };

// A migration file's own BEGIN and COMMIT are dropped: a pooled client can run
// them on different connections, leaving one holding an open transaction.
export function migrationStatements(directory: string, name: string): string[] {
  return readFileSync(path.join(directory, name, 'migration.sql'), 'utf8')
    .split(';')
    .map(part => part.trim())
    .filter(part => part && !/^(BEGIN|COMMIT)$/i.test(part));
}

export async function applyMigration(client: RawClient, directory: string, name: string) {
  for (const statement of migrationStatements(directory, name)) await client.$executeRawUnsafe(statement);
}
