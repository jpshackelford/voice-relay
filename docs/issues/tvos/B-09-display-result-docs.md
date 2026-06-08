# B-09 — Document `display-result` semantics for tvOS clients

## Problem statement

The web kiosk reports the outcome of every server-pushed display
(success, failure, image load timeout, rendered line count) back
over the WebSocket as a `display-result` message. The AI uses
those signals — especially `lines` — to make content-sizing
decisions. We haven't documented what a tvOS client should send,
particularly for `lines`, since React Native has no DOM-line
concept.

Until the contract is clear, tvOS clients are likely to send
either no `display-result` (silent breakage of AI heuristics) or
the wrong shape (heuristics get bad signal).

## Proposed solution

- Extend `docs/TVOS_CLIENT.md` with a `display-result` section
  that:
  - Documents the message shape and each field's semantics.
  - States the contract: clients should send a result for every
    display event (success or failure).
  - Gives tvOS-specific guidance for `lines`: best-effort
    estimation (e.g. rendered text length / characters-per-
    line) is acceptable, and `null` is acceptable when no
    estimate is possible.
- No server-side code change; this is documentation.

## Demonstration

1. Open the updated `docs/TVOS_CLIENT.md` on GitHub and show
   the new section is clear about each field and the tvOS
   expectations for `lines`.
2. Show that the section links back to the AI sizing behavior
   it informs (whichever existing doc covers that).
3. (Optional) Show a sample log line from a tvOS client
   sending a well-formed `display-result` message against the
   dev server.
