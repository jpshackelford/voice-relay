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

/**
 * Returns true when the kind string represents an observation (result-side)
 * event rather than an action (request-side). The convention across the
 * OpenHands V1 event stream is that observation kinds always contain the
 * substring `"Observation"` (e.g. `ExecuteBashObservation`,
 * `FileEditorObservation`, `MCPToolObservation`).
 *
 * Hoisted alongside `formatActionKind` so both consumers
 * (`AgentEventCard.tsx` and `KioskMode.tsx`, issue #346) share a single
 * implementation.
 */
export function isObservationKind(kind: string): boolean {
  return kind.includes('Observation');
}
