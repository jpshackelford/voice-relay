import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useWorkspaces, type Workspace } from '../hooks/useWorkspaces';
import { useSessions, type SessionSummary } from '../hooks/useSessions';
import { useDevices, type DeviceInfo } from '../hooks/useDevices';

// Format relative time (e.g., "2m ago", "1hr ago")
function formatRelativeTime(date: string): string {
  const now = new Date();
  const then = new Date(date);
  const diffMs = now.getTime() - then.getTime();
  
  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}hr ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'just now';
}

// Format time (e.g., "2:30pm")
function formatTime(date: string): string {
  return new Date(date).toLocaleTimeString('en-US', { 
    hour: 'numeric', 
    minute: '2-digit',
    hour12: true 
  }).toLowerCase();
}

interface EditableDeviceNameProps {
  device: DeviceInfo;
  onRename: (id: string, name: string) => Promise<void>;
}

function EditableDeviceName({ device, onRename }: EditableDeviceNameProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState(device.name);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (name.trim() === device.name || !name.trim()) {
      setIsEditing(false);
      setName(device.name);
      return;
    }
    
    setSaving(true);
    try {
      await onRename(device.id, name.trim());
      setIsEditing(false);
    } catch (err) {
      console.error('Failed to rename device:', err);
      setName(device.name);
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSave();
    } else if (e.key === 'Escape') {
      setIsEditing(false);
      setName(device.name);
    }
  };

  if (isEditing) {
    return (
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={handleSave}
        onKeyDown={handleKeyDown}
        autoFocus
        disabled={saving}
        className="device-name-input"
      />
    );
  }

  return (
    <span className="device-name-text" onClick={() => setIsEditing(true)}>
      {device.name}
      <button className="rename-btn" title="Rename device">✏️</button>
    </span>
  );
}

export function WorkspaceHome() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { workspaces, loading: workspacesLoading } = useWorkspaces();
  const { sessions, loading: sessionsLoading, createSession } = useSessions(workspaceId);
  const { devices, loading: devicesLoading, renameDevice } = useDevices(workspaceId);
  
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [showWorkspaceDropdown, setShowWorkspaceDropdown] = useState(false);
  const [creatingSession, setCreatingSession] = useState(false);

  // Find current workspace from list
  useEffect(() => {
    if (workspaces.length > 0 && workspaceId) {
      const found = workspaces.find(w => w.id === workspaceId);
      setWorkspace(found || null);
    }
  }, [workspaces, workspaceId]);

  // Auto-create session if none exist
  useEffect(() => {
    if (!sessionsLoading && sessions.length === 0 && workspaceId && !creatingSession) {
      setCreatingSession(true);
      createSession()
        .then(() => {
          setCreatingSession(false);
        })
        .catch((err) => {
          console.error('Failed to auto-create session:', err);
          setCreatingSession(false);
        });
    }
  }, [sessionsLoading, sessions.length, workspaceId, createSession, creatingSession]);

  const handleViewSession = (session: SessionSummary) => {
    // Navigate to the workspace with session context
    // Mobile devices get conversation view, desktop gets kiosk
    navigate(`/workspace/${workspaceId}?session=${session.id}`);
  };

  const handleNewSession = async () => {
    setCreatingSession(true);
    try {
      const session = await createSession();
      handleViewSession(session);
    } catch (err) {
      console.error('Failed to create session:', err);
    } finally {
      setCreatingSession(false);
    }
  };

  const handleSwitchWorkspace = (ws: Workspace) => {
    setShowWorkspaceDropdown(false);
    navigate(`/workspace/${ws.id}`);
  };

  const loading = workspacesLoading || sessionsLoading || devicesLoading;

  if (loading && !workspace) {
    return (
      <div className="workspace-home loading">
        <div className="loading-spinner">Loading workspace...</div>
      </div>
    );
  }

  if (!workspace) {
    return (
      <div className="workspace-home error">
        <h2>Workspace not found</h2>
        <p>The workspace you're looking for doesn't exist or you don't have access to it.</p>
        <button onClick={() => navigate('/dashboard')}>Back to Dashboard</button>
      </div>
    );
  }

  return (
    <div className="workspace-home">
      <header className="workspace-header">
        <div className="workspace-title-area">
          <div className="workspace-dropdown-container">
            <button 
              className="workspace-dropdown-trigger"
              onClick={() => setShowWorkspaceDropdown(!showWorkspaceDropdown)}
            >
              <span className="workspace-name">{workspace.name}</span>
              <span className="dropdown-arrow">▼</span>
            </button>
            
            {showWorkspaceDropdown && (
              <div className="workspace-dropdown">
                {workspaces.map(ws => (
                  <button
                    key={ws.id}
                    className={`workspace-dropdown-item ${ws.id === workspaceId ? 'active' : ''}`}
                    onClick={() => handleSwitchWorkspace(ws)}
                  >
                    {ws.name}
                    {ws.isOwner && <span className="owner-badge">Owner</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        
        <div className="header-actions">
          {user && (
            <div className="user-info">
              {user.avatarUrl && (
                <img src={user.avatarUrl} alt={user.username} className="user-avatar" />
              )}
              <span className="user-name">{user.displayName || user.username}</span>
            </div>
          )}
          <button className="logout-btn" onClick={logout}>Sign out</button>
        </div>
      </header>

      <main className="workspace-content">
        {/* Devices Section */}
        <section className="devices-section">
          <h2>
            <span className="section-icon">📱</span>
            Devices ({devices.length})
          </h2>
          
          <div className="devices-list">
            {devices.length === 0 ? (
              <p className="empty-message">No devices connected yet. Open this workspace on another device to connect.</p>
            ) : (
              devices.map(device => (
                <div key={device.id} className={`device-row ${device.isCurrentDevice ? 'current' : ''}`}>
                  <span className="device-icon">
                    {device.mode === 'kiosk' ? '🖥️' : '📱'}
                  </span>
                  <div className="device-details">
                    <EditableDeviceName device={device} onRename={renameDevice} />
                    {device.isCurrentDevice && <span className="current-badge">(this device)</span>}
                  </div>
                  <span className="device-last-seen">
                    {device.lastSeenAt ? formatRelativeTime(device.lastSeenAt) : 'never'}
                  </span>
                </div>
              ))
            )}
          </div>
        </section>

        {/* Sessions Section */}
        <section className="sessions-section">
          <div className="section-header">
            <h2>
              <span className="section-icon">💬</span>
              Sessions
            </h2>
            <button 
              className="new-session-btn" 
              onClick={handleNewSession}
              disabled={creatingSession}
            >
              {creatingSession ? 'Creating...' : '+ New Session'}
            </button>
          </div>
          
          <div className="sessions-list">
            {sessions.length === 0 && !creatingSession ? (
              <p className="empty-message">No sessions yet.</p>
            ) : (
              sessions.map(session => (
                <div key={session.id} className={`session-row ${session.status}`}>
                  <div className="session-info">
                    <span className="session-name">{session.name || `Session ${session.id.slice(0, 8)}`}</span>
                    <span className="session-meta">
                      Created {formatTime(session.startedAt)}
                    </span>
                  </div>
                  <span className="session-last-active">
                    {formatRelativeTime(session.lastActiveAt)}
                  </span>
                  <button 
                    className="view-session-btn"
                    onClick={() => handleViewSession(session)}
                  >
                    View →
                  </button>
                </div>
              ))
            )}
          </div>
        </section>

        {/* Settings Section (Join Code for owners) */}
        {workspace.isOwner && workspace.joinCode && (
          <section className="settings-section">
            <h2>
              <span className="section-icon">⚙️</span>
              Settings
            </h2>
            <div className="settings-content">
              <div className="setting-row">
                <label>Join Code</label>
                <code className="join-code">{workspace.joinCode}</code>
                <span className="setting-hint">Share this code to let others join your workspace</span>
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
