/**
 * Format an OpenHands action/observation `kind` (e.g. `"ExecuteBashAction"`)
 * into a human-readable title (`"Execute Bash"`).
 *
 * Hoisted out of `AgentEventCard.tsx` so the kiosk footer ticker
 * (issue #340) can share the same formatting and so the function is unit-
 * testable in isolation.
 */
export function formatActionKind(kind: string): string {
  return kind
    .replace(/Action$/, '')
    .replace(/Observation$/, '')
    .replace(/Event$/, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim();
}
