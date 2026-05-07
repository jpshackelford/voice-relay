import type { PendingJoinRequestInfo } from '../hooks/useJoinRequests';

interface JoinRequestNotificationProps {
  /** The pending join request */
  request: PendingJoinRequestInfo;
  /** Approve the request */
  onApprove: (requestId: string) => void;
  /** Deny the request */
  onDeny: (requestId: string) => void;
}

/**
 * Toast/card notification shown on kiosk when a user requests to join.
 * Displays user avatar, name, and approve/deny buttons.
 */
export function JoinRequestNotification({
  request,
  onApprove,
  onDeny,
}: JoinRequestNotificationProps) {
  const displayName = request.user.displayName || request.user.username;

  return (
    <div className="join-request-notification">
      <div className="join-request-avatar">
        {request.user.avatarUrl ? (
          <img src={request.user.avatarUrl} alt={displayName} />
        ) : (
          <div className="avatar-placeholder">
            {displayName.charAt(0).toUpperCase()}
          </div>
        )}
      </div>
      <div className="join-request-content">
        <div className="join-request-title">Join Request</div>
        <div className="join-request-user">
          <strong>{displayName}</strong>
          {request.user.displayName && (
            <span className="username">@{request.user.username}</span>
          )}
        </div>
        <div className="join-request-hint">wants to join this workspace</div>
      </div>
      <div className="join-request-actions">
        <button
          className="approve-btn"
          onClick={() => onApprove(request.id)}
          title="Approve request"
        >
          ✓
        </button>
        <button
          className="deny-btn"
          onClick={() => onDeny(request.id)}
          title="Deny request"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

interface JoinRequestStackProps {
  /** List of pending join requests */
  requests: PendingJoinRequestInfo[];
  /** Approve a request */
  onApprove: (requestId: string) => void;
  /** Deny a request */
  onDeny: (requestId: string) => void;
}

/**
 * Stack of join request notifications for displaying multiple
 * pending requests on kiosk.
 */
export function JoinRequestStack({
  requests,
  onApprove,
  onDeny,
}: JoinRequestStackProps) {
  if (requests.length === 0) {
    return null;
  }

  return (
    <div className="join-request-stack">
      {requests.map((request) => (
        <JoinRequestNotification
          key={request.id}
          request={request}
          onApprove={onApprove}
          onDeny={onDeny}
        />
      ))}
    </div>
  );
}
