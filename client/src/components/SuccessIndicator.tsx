import type { ObservationStatus } from '../types';

interface SuccessIndicatorProps {
  status: ObservationStatus;
}

/**
 * Displays success/timeout status icons for agent observations.
 * Based on OpenHands' success-indicator.tsx patterns.
 * 
 * - success: ✅ green checkmark
 * - timeout: 🕐 yellow clock
 * - error: nothing (absence of checkmark implies failure)
 * - pending: nothing (waiting for observation)
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

  // For 'error' and 'pending' status, render nothing
  // Absence of checkmark implies failure or still waiting
  return null;
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
