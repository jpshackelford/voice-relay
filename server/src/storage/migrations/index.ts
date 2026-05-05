import { migration as migration001 } from './001_messages.js';
import type { Migration } from '../migrator.js';

export const migrations: Migration[] = [
  migration001,
];

export function getMigrations(): Migration[] {
  return [...migrations].sort((a, b) => a.version - b.version);
}
