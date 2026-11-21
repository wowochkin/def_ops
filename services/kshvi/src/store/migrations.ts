import { readFileSync } from 'node:fs';
import type { Migration } from '@def-ops/db';

export const KSHVI_MIGRATIONS: Migration[] = [{
  id: 1,
  name: 'core-event-store',
  sql: readFileSync(new URL('./migrations/001-core.sql', import.meta.url), 'utf8'),
}];
