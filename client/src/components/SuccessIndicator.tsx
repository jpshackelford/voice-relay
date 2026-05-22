import type { ObservationStatus } from '../types';

interface SuccessIndicatorProps {
  status: ObservationStatus;
}

/**
 * Displays success/timeout status icons for agent observations.
 * Based on OpenHands' success-indicator.tsx patterns.
 * 
 * - success: ✓ checkmark
 * - timeout: ⏱ clock
 * - error:   ✗ cross
 * - pending: ⋯ ellipsis (action in flight, observation not yet received)
 */
export function SuccessIndicator({ status }: SuccessIndicatorProps) {
  if (status === 'success') {
    return (
      <span className="success-indicator success" title="Success">
        ✓
      </span>
    );
  }

  if (status === 'timeout') {
    return (
      <span className="success-indicator timeout" title="Timeout">
        ⏱
      </span>
    );
  }

  if (status === 'error') {
    return (
      <span className="success-indicator error" title="Error">
        ✗
      </span>
    );
  }

  // Pending: the action has been emitted but no observation has arrived yet.
  // Show an explicit badge so an in-flight action is visually distinct from a
  // silently-succeeded one (issue #265).
  return (
    <span className="success-indicator pending" title="Pending">
      ⋯
    </span>
  );
}

/**
 * Determine observation status from exit code.
 * Logic based on OpenHands get-observation-result.ts
 */
export function getObservationStatus(
  exitCode: number | undefined,
  isError?: boolean,
  isTimeout?: boolean
): ObservationStatus {
  if (isTimeout || exitCode === -1) {
    return 'timeout';
  }
  if (exitCode === 0) {
    return 'success';
  }
  if (isError || (exitCode !== undefined && exitCode !== 0)) {
    return 'error';
  }
  // No exit code yet = still pending
  return 'pending';
}
