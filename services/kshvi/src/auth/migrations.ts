import { readFileSync } from 'node:fs';
import type { Migration } from '@def-ops/db';

export const KSHVI_AUTH_MIGRATIONS: Migration[] = [{
  id: 2,
  name: 'local-auth',
  sql: readFileSync(new URL('../store/migrations/002-auth.sql', import.meta.url), 'utf8'),
}];
