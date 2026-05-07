import { useState } from 'react';
import type { PendingJoinRequest } from '../hooks/useWorkspaceAutoJoin';

interface WaitingForApprovalProps {
  /** Pending join request info */
  request: PendingJoinRequest;
  /** Cancel the pending request */
  onCancel: () => Promise<void>;
}

/**
 * Full-screen overlay shown when user is waiting for workspace owner
 * to approve their join request.
 */
export function WaitingForApproval({ request, onCancel }: WaitingForApprovalProps) {
  const [cancelling, setCancelling] = useState(false);

  const handleCancel = async () => {
    if (cancelling) return;
    setCancelling(true);
    try {
      await onCancel();
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div className="waiting-for-approval-overlay">
      <div className="waiting-for-approval-card">
        <div className="spinner waiting-spinner"></div>
        <h2>Waiting for approval...</h2>
        <p className="workspace-name">
          Requesting to join <strong>{request.workspaceName}</strong>
        </p>
        <p className="waiting-hint">
          The workspace owner will see your request on their device
        </p>
        <button 
          className="cancel-request-btn" 
          onClick={handleCancel}
          disabled={cancelling}
        >
          {cancelling ? 'Cancelling...' : 'Cancel Request'}
        </button>
      </div>
    </div>
  );
}
