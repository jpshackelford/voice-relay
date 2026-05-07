import { migration as migration001 } from './001_messages.js';
import { migration as migration002 } from './002_users.js';
import { migration as migration003 } from './003_workspaces.js';
import { migration as migration004 } from './004_messages_workspace.js';
import { migration as migration005 } from './005_devices_sessions.js';
import { migration as migration006 } from './006_device_token_security.js';
import { migration as migration007 } from './007_allow_auto_join.js';
import { migration as migration008 } from './008_qr_tokens.js';
import { migration as migration009 } from './009_join_requests.js';
import type { Migration } from '../migrator.js';

export const migrations: Migration[] = [
  migration001,
  migration002,
  migration003,
  migration004,
  migration005,
  migration006,
  migration007,
  migration008,
  migration009,
];

export function getMigrations(): Migration[] {
  return [...migrations].sort((a, b) => a.version - b.version);
}
