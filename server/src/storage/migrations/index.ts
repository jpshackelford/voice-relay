import { migration as migration001 } from './001_messages.js';
import { migration as migration002 } from './002_users.js';
import type { Migration } from '../migrator.js';

export const migrations: Migration[] = [
  migration001,
  migration002,
];

export function getMigrations(): Migration[] {
  return [...migrations].sort((a, b) => a.version - b.version);
}
