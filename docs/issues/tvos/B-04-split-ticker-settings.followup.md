> Proposed first comment for B-04. Post after filing the issue.

## Proposed technical implementation

- New migration `0XX_split_kiosk_ticker_settings.ts` adds two
  boolean columns to `workspace_settings`. Both default-fill
  from the existing `kiosk_footer_tickers_enabled` for current
  rows; default `FALSE` for new rows.
- Server side: extend `workspace-repository` settings shape;
  update `GET /api/workspaces/:id/kiosk-config` response;
  update the settings PATCH validator.
- Web client: `KioskMode.tsx` accepts two new props in place of
  `kioskFooterTickersEnabled`. Existing tests
  (`KioskMode.test.tsx`, `KioskMode.claim-flow.test.tsx`)
  updated. New test: speaker on, agent off — only the speaker
  strip is in the DOM.
- Web client: Workspace settings UI swaps the one switch for
  two, with explanatory copy under each.
- Backwards-compat: keep `kioskFooterTickersEnabled` as a
  computed value (`speaker && agent`) returned from the same
  endpoints for one release; mark deprecated in `README.md`.

## Out of scope

- Per-device overrides for either ticker. The current shape is
  workspace-scoped because the ticker is a "what the room
  shows" preference; per-device makes sense only if we hear it
  requested.
- Sub-knobs on the speaker ticker (e.g. "speakers I exclude").
  Future ask.

## Open questions

- How long to keep the deprecated `kioskFooterTickersEnabled`
  field. One release feels right; flag for review at the
  release-notes step.
