import type { PendingJoinRequest } from '../hooks/useWorkspaceAutoJoin';

interface WaitingForApprovalProps {
  /** Pending join request info */
  request: PendingJoinRequest;
  /** Cancel the pending request */
  onCancel: () => void;
}

/**
 * Full-screen overlay shown when user is waiting for workspace owner
 * to approve their join request.
 */
export function WaitingForApproval({ request, onCancel }: WaitingForApprovalProps) {
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
        <button className="cancel-request-btn" onClick={onCancel}>
          Cancel Request
        </button>
      </div>
    </div>
  );
}
