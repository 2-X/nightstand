#!/usr/bin/env node
// Data-compatibility dry run for the fork-switch tool. Report-only; it
// never writes anything. Loads
// the migrating pod's existing lowdb JSON through OUR zod schemas (in
// `.deepPartial()` mode, same technique the real settings POST route uses
// for partial updates, server/src/routes/settings/settings.ts) and reports
// what would happen, split into two categories:
//
//   - harmless: extra fields from the other fork that we don't recognize,
//     these get silently dropped, same as any settings write today.
//   - destructive: a field OUR schema also has, present with an
//     incompatible shape, this is the one real cross-fork data risk, and
//     is the only thing that fails this check.
//
// A field missing entirely is neither, `.deepPartial()` makes every field
// optional, so a genuinely absent field just gets today's default the next
// time settings are read (the same behavior a normal upgrade already has).
//
// Exit 0: safe to proceed. Exit 1: destructive issues found (pod-installer.sh
// aborts pre-swap and prints this report).
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { SettingsSchema } from '../../server/dist/db/settingsSchema.js';
import { SchedulesSchema } from '../../server/dist/db/schedulesSchema.js';

const LOWDB_DIR = process.env.FS_MIGRATE_LOWDB_DIR || '/persistent/free-sleep-data/lowdb';

function loadJson(file) {
  const full = path.join(LOWDB_DIR, file);
  if (!existsSync(full)) return { present: false };
  try {
    return { present: true, data: JSON.parse(readFileSync(full, 'utf8')) };
  } catch (err) {
    return { present: true, parseError: String(err) };
  }
}

function classify(schema, loaded, label) {
  if (!loaded.present) {
    console.log(`[${label}] no existing file, nothing to check.`);
    return [];
  }
  if (loaded.parseError) {
    console.log(`[${label}] existing file is not valid JSON: ${loaded.parseError}`);
    return [`${label}: file is not valid JSON`];
  }
  const result = schema.deepPartial().safeParse(loaded.data);
  if (result.success) {
    console.log(`[${label}] compatible with this fork's schema, nothing would be dropped.`);
    return [];
  }
  const harmless = [];
  const destructive = [];
  for (const issue of result.error.issues) {
    const at = issue.path.join('.') || '(root)';
    if (issue.code === 'unrecognized_keys') {
      harmless.push(`${at}: extra field(s) from the other fork will be dropped: ${(issue.keys || []).join(', ')}`);
    } else {
      destructive.push(`${at}: ${issue.message} (${issue.code})`);
    }
  }
  if (harmless.length) {
    console.log(`[${label}] harmless, dropped silently, same as any settings write:`);
    harmless.forEach(m => console.log(`  - ${m}`));
  }
  if (destructive.length) {
    console.log(`[${label}] POTENTIALLY DESTRUCTIVE, present but in a shape this fork can't use:`);
    destructive.forEach(m => console.log(`  - ${m}`));
  }
  return destructive;
}

console.log('Data-compatibility dry run (report-only, nothing is written):');
const destructive = [
  ...classify(SettingsSchema, loadJson('settingsDB.json'), 'settings'),
  ...classify(SchedulesSchema, loadJson('schedulesDB.json'), 'schedules'),
];

if (destructive.length > 0) {
  console.log(`\n${destructive.length} potentially destructive issue(s) found. Aborting before touching your data.`);
  process.exit(1);
}
console.log('\nNo destructive issues found. Safe to proceed.');
process.exit(0);
