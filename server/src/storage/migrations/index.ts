import { migration as migration001 } from './001_messages.js';
import { migration as migration002 } from './002_users.js';
import { migration as migration003 } from './003_workspaces.js';
import { migration as migration004 } from './004_messages_workspace.js';
import { migration as migration005 } from './005_devices_sessions.js';
import { migration as migration006 } from './006_device_token_security.js';
import { migration as migration007 } from './007_allow_auto_join.js';
import { migration as migration008 } from './008_qr_tokens.js';
import { migration as migration009 } from './009_join_requests.js';
import { migration as migration010 } from './010_display_api_secrets.js';
import { migration as migration011 } from './011_elevenlabs.js';
import { migration as migration012 } from './012_agent_events.js';
import { migration as migration013 } from './013_fk_orphan_cleanup.js';
import { migration as migration014 } from './014_user_github_installation.js';
import { migration as migration015 } from './015_kiosk_footer_tickers.js';
import { migration as migration016 } from './016_default_agent_prompt.js';
import { migration as migration017 } from './017_speakers.js';
import { migration as migration018 } from './018_session_target_kiosk.js';
import { migration as migration019 } from './019_hosted_stt.js';
import { migration as migration020 } from './020_session_ai_state.js';
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
  migration010,
  migration011,
  migration012,
  migration013,
  migration014,
  migration015,
  migration016,
  migration017,
  migration018,
  migration019,
  migration020,
];

export function getMigrations(): Migration[] {
  return [...migrations].sort((a, b) => a.version - b.version);
}
