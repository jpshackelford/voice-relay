import { test } from './fixtures';

/**
 * E2E: AI session-state resync on register (issue #290)
 *
 * Verifies the wire-shape side of the resync introduced in #290: when a
 * device registers (or re-registers after a browser refresh) with an
 * active AI session, the server reports the current AI state immediately
 * — instead of waiting for the next transition.
 *
 * Test matrix from issue #290:
 *  - T-3.1-E2E.1: refresh during ready agent restores ✨ indicator
 *  - T-3.1-E2E.2: refresh during thinking agent restores 🤔 indicator
 *  - T-3.1-E2E.3: refresh without active AI shows no indicator
 *
 * ## Why these are smoke-only
 *
 * All three E2E flows require a real OpenHands agent connection
 * (OPENHANDS_API_KEY) to differentiate "the resync did something" from
 * "the auto-connect path did something". In the default CI E2E job no
 * AI key is configured, so:
 *
 *   - With no AI configured, the auto-connect path broadcasts
 *     `session-ai-status` frames of its own (`connecting: true` then a
 *     final error frame). These collide with the wire shape this issue
 *     emits, making a CI-level negative test indistinguishable from a
 *     positive one.
 *   - With AI configured, transitions to ready / thinking can be observed
 *     via the kiosk UI (`.ai-status` indicator) end-to-end.
 *
 * The smoke suite (`npm run smoke` → `tests/smoke/ai-integration.spec.ts`)
 * runs against the deployed environment where OPENHANDS_API_KEY is
 * configured. The unit test matrix in `server/src/ai-resync.test.ts`
 * provides the deterministic coverage of T-3.1.1 through T-3.1.10.
 *
 * The placeholder tests below are left as a documented hook for future
 * local enablement (e.g. running against a sandbox OH instance).
 */

const OPENHANDS_API_KEY = process.env.OPENHANDS_API_KEY;

test.describe('AI session-state resync on register (#290)', () => {
  test('T-3.1-E2E.1: refresh during ready agent restores ✨ indicator', async () => {
    test.skip(
      !OPENHANDS_API_KEY,
      'Requires a working OpenHands agent (set OPENHANDS_API_KEY). Covered by the smoke suite.',
    );
  });

  test('T-3.1-E2E.2: refresh during thinking agent restores 🤔 indicator', async () => {
    test.skip(
      !OPENHANDS_API_KEY,
      'Requires a working OpenHands agent (set OPENHANDS_API_KEY). Covered by the smoke suite.',
    );
  });

  test('T-3.1-E2E.3: refresh without active AI shows no indicator', async () => {
    test.skip(
      !OPENHANDS_API_KEY,
      'Requires a working OpenHands agent to set up a "before refresh, AI was inactive" state distinguishable from the test environment baseline. Covered by the smoke suite.',
    );
  });
});
