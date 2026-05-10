import { useState, useEffect } from 'react';
import { useDeletionPreview } from '../hooks/useDeletionPreview';

interface Workspace {
  id: string;
  name: string;
}

interface DeleteWorkspaceModalProps {
  workspace: Workspace;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}

export function DeleteWorkspaceModal({ workspace, onConfirm, onCancel }: DeleteWorkspaceModalProps) {
  const [confirmName, setConfirmName] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { counts, loading: countsLoading, error: countsError } = useDeletionPreview(workspace.id);

  const nameMatches = confirmName.trim() === workspace.name;

  // Clear error when user types
  useEffect(() => {
    if (error && confirmName) {
      setError(null);
    }
  }, [confirmName, error]);

  const handleDelete = async () => {
    if (!nameMatches) return;
    
    setDeleting(true);
    setError(null);
    try {
      await onConfirm();
    } catch (err) {
      setError((err as Error).message || 'Failed to delete workspace');
      setDeleting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && nameMatches && !deleting) {
      handleDelete();
    } else if (e.key === 'Escape' && !deleting) {
      onCancel();
    }
  };

  const formatCount = (count: number, singular: string, plural: string) => {
    return `${count} ${count === 1 ? singular : plural}`;
  };

  return (
    <div className="modal-overlay" onClick={deleting ? undefined : onCancel}>
      <div className="modal-content delete-workspace-modal" onClick={e => e.stopPropagation()}>
        <div className="delete-workspace-header">
          <span className="warning-icon">⚠️</span>
          <h3>Delete Workspace</h3>
        </div>

        <p className="delete-workspace-warning">
          This action <strong>cannot be undone</strong>. This will permanently delete the 
          workspace <strong>"{workspace.name}"</strong> and all of its data.
        </p>

        {/* Deletion counts */}
        {countsLoading ? (
          <div className="deletion-counts loading">
            Loading workspace data...
          </div>
        ) : countsError ? (
          <div className="deletion-counts error">
            Unable to load workspace data: {countsError}
          </div>
        ) : counts ? (
          <div className="deletion-counts">
            <p>The following will be permanently deleted:</p>
            <ul>
              <li>{formatCount(counts.sessions, 'session', 'sessions')}</li>
              <li>{formatCount(counts.devices, 'device', 'devices')}</li>
              <li>{formatCount(counts.messages, 'message', 'messages')}</li>
              <li>{formatCount(counts.members - 1, 'member', 'members')} (besides you)</li>
            </ul>
          </div>
        ) : null}

        {/* Confirmation input */}
        <div className="delete-confirm-input">
          <label htmlFor="confirm-workspace-name">
            Type <strong>{workspace.name}</strong> to confirm:
          </label>
          <input
            id="confirm-workspace-name"
            type="text"
            value={confirmName}
            onChange={(e) => setConfirmName(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={workspace.name}
            disabled={deleting}
            autoFocus
            autoComplete="off"
          />
        </div>

        {error && (
          <div className="delete-workspace-error">
            {error}
          </div>
        )}

        <div className="modal-actions">
          <button
            className="modal-btn cancel"
            onClick={onCancel}
            disabled={deleting}
          >
            Cancel
          </button>
          <button
            className="modal-btn danger delete-workspace-btn"
            onClick={handleDelete}
            disabled={!nameMatches || deleting}
          >
            {deleting ? 'Deleting...' : 'Delete Workspace'}
          </button>
        </div>
      </div>
    </div>
  );
}
