import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams, useSearchParams, Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useWorkspaces, type Workspace } from '../hooks/useWorkspaces';
import { useSessions, type SessionSummary } from '../hooks/useSessions';
import { useDevices, type DeviceInfo } from '../hooks/useDevices';
import { useWorkspaceSettings } from '../hooks/useWorkspaceSettings';

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
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (name.trim() === device.name || !name.trim()) {
      setIsEditing(false);
      setName(device.name);
      setError(null);
      return;
    }
    
    setSaving(true);
    setError(null);
    try {
      await onRename(device.id, name.trim());
      setIsEditing(false);
    } catch (err) {
      console.error('Failed to rename device:', err);
      setName(device.name);
      setError('Failed to rename device');
      // Clear error after 3 seconds
      setTimeout(() => setError(null), 3000);
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
      setError(null);
    }
  };

  if (isEditing) {
    return (
      <span className="device-name-editing">
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
        {error && <span className="rename-error">{error}</span>}
      </span>
    );
  }

  return (
    <span className="device-name-text" onClick={() => setIsEditing(true)}>
      {device.name}
      <button className="rename-btn" title="Rename device">✏️</button>
      {error && <span className="rename-error">{error}</span>}
    </span>
  );
}

interface EditableSessionNameProps {
  session: SessionSummary;
  onRename: (id: string, name: string) => Promise<void>;
}

function EditableSessionName({ session, onRename }: EditableSessionNameProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState(session.name || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const displayName = session.name || `Session ${session.id.slice(0, 8)}`;

  const handleSave = async () => {
    const trimmedName = name.trim();
    
    // Empty name reverts to original (no error)
    if (!trimmedName) {
      setIsEditing(false);
      setName(session.name || '');
      setError(null);
      return;
    }
    
    // No change, just close
    if (trimmedName === session.name) {
      setIsEditing(false);
      return;
    }
    
    setSaving(true);
    setError(null);
    try {
      await onRename(session.id, trimmedName);
      setIsEditing(false);
    } catch (err) {
      console.error('Failed to rename session:', err);
      setName(session.name || '');
      setError('Failed to rename');
      setTimeout(() => setError(null), 3000);
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSave();
    } else if (e.key === 'Escape') {
      setIsEditing(false);
      setName(session.name || '');
      setError(null);
    }
  };

  if (isEditing) {
    return (
      <span className="session-name-editing">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={handleSave}
          onKeyDown={handleKeyDown}
          autoFocus
          disabled={saving}
          className="session-name-input"
          placeholder={`Session ${session.id.slice(0, 8)}`}
        />
        {error && <span className="rename-error">{error}</span>}
      </span>
    );
  }

  return (
    <span className="session-name-text" onClick={() => setIsEditing(true)}>
      {displayName}
      <button className="rename-btn" title="Rename session">✏️</button>
      {error && <span className="rename-error">{error}</span>}
    </span>
  );
}

interface SessionKebabMenuProps {
  onArchive: () => void;
  onRenameClick: () => void;
}

function SessionKebabMenu({ onArchive, onRenameClick }: SessionKebabMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  return (
    <div className="session-kebab-menu" ref={menuRef}>
      <button
        className="session-kebab-btn"
        onClick={() => setIsOpen(!isOpen)}
        title="More options"
      >
        ⋮
      </button>
      {isOpen && (
        <div className="session-dropdown">
          <button
            className="session-dropdown-item"
            onClick={() => {
              setIsOpen(false);
              onRenameClick();
            }}
          >
            ✏️ Rename
          </button>
          <button
            className="session-dropdown-item archive"
            onClick={() => {
              setIsOpen(false);
              onArchive();
            }}
          >
            📦 Archive
          </button>
        </div>
      )}
    </div>
  );
}

export function WorkspaceHome() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { workspaces, loading: workspacesLoading } = useWorkspaces();
  const { sessions, loading: sessionsLoading, createSession, renameSession, archiveSession } = useSessions(workspaceId);
  const { devices, loading: devicesLoading, renameDevice, removeDevice } = useDevices(workspaceId);

  // Redirect legacy bookmarks: /workspace/:id?session=X -> /workspace/:id/session/X
  const sessionParam = searchParams.get('session');
  if (sessionParam) {
    return <Navigate to={`/workspace/${workspaceId}/session/${sessionParam}`} replace />;
  }
  
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [showWorkspaceDropdown, setShowWorkspaceDropdown] = useState(false);
  const [creatingSession, setCreatingSession] = useState(false);
  
  // Device removal state
  const [deviceToRemove, setDeviceToRemove] = useState<DeviceInfo | null>(null);
  const [removingDevice, setRemovingDevice] = useState(false);
  const [removeDeviceMessage, setRemoveDeviceMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Session archive state
  const [sessionToArchive, setSessionToArchive] = useState<SessionSummary | null>(null);
  const [archivingSession, setArchivingSession] = useState(false);
  const [archiveToast, setArchiveToast] = useState<string | null>(null);

  // Session edit mode tracking (for triggering edit from kebab menu)
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  
  // Invite link copy state
  const [inviteLinkCopied, setInviteLinkCopied] = useState(false);
  const [inviteLinkError, setInviteLinkError] = useState(false);
  
  // API key settings state
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [apiKeyStatus, setApiKeyStatus] = useState<'idle' | 'saving' | 'testing' | 'removing'>('idle');
  const [apiKeyMessage, setApiKeyMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Version info from health endpoint
  const [version, setVersion] = useState<string | null>(null);

  // Workspace settings hook
  const { 
    settings, 
    setApiKey, 
    testApiKey, 
    removeApiKey 
  } = useWorkspaceSettings(workspaceId, workspace?.isOwner ?? false);
  
  // Use ref to prevent race condition with auto-create
  // Ref persists across re-renders and is set synchronously before the async call
  const autoCreatingRef = useRef(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Click-away handler to close dropdown
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowWorkspaceDropdown(false);
      }
    };
    if (showWorkspaceDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showWorkspaceDropdown]);

  // Fetch version info from health endpoint
  useEffect(() => {
    fetch('/health')
      .then(res => res.json())
      .then(data => setVersion(data.version || null))
      .catch(() => setVersion(null));
  }, []);

  // Find current workspace from list
  useEffect(() => {
    if (workspaces.length > 0 && workspaceId) {
      const found = workspaces.find(w => w.id === workspaceId);
      setWorkspace(found || null);
    }
  }, [workspaces, workspaceId]);

  // Auto-create session if none exist
  useEffect(() => {
    // Check ref synchronously to prevent race condition with component remount
    if (!sessionsLoading && sessions.length === 0 && workspaceId && !autoCreatingRef.current) {
      autoCreatingRef.current = true;
      setCreatingSession(true);
      createSession()
        .then(() => {
          setCreatingSession(false);
        })
        .catch((err) => {
          console.error('Failed to auto-create session:', err);
          setCreatingSession(false);
          autoCreatingRef.current = false; // Allow retry on error
        });
    }
  }, [sessionsLoading, sessions.length, workspaceId, createSession]);

  const handleViewSession = (session: SessionSummary) => {
    // Navigate to the direct session view URL
    navigate(`/workspace/${workspaceId}/session/${session.id}`);
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

  // Device removal handlers
  const handleRemoveDeviceClick = (device: DeviceInfo) => {
    setDeviceToRemove(device);
    setRemoveDeviceMessage(null);
  };

  const handleCancelRemoveDevice = () => {
    setDeviceToRemove(null);
    setRemoveDeviceMessage(null);
  };

  const handleConfirmRemoveDevice = async () => {
    if (!deviceToRemove) return;

    setRemovingDevice(true);
    setRemoveDeviceMessage(null);

    try {
      const deviceName = deviceToRemove.name;
      await removeDevice(deviceToRemove.id);
      setDeviceToRemove(null);
      setRemoveDeviceMessage({ type: 'success', text: `Device "${deviceName}" removed successfully` });
      // Clear success message after 3 seconds
      setTimeout(() => setRemoveDeviceMessage(null), 3000);
    } catch (err) {
      setRemoveDeviceMessage({ type: 'error', text: (err as Error).message });
    } finally {
      setRemovingDevice(false);
    }
  };

  // Session archive handlers
  const handleArchiveClick = (session: SessionSummary) => {
    setSessionToArchive(session);
  };

  const handleCancelArchive = () => {
    setSessionToArchive(null);
  };

  const handleConfirmArchive = async () => {
    if (!sessionToArchive) return;

    setArchivingSession(true);

    try {
      const sessionName = sessionToArchive.name || `Session ${sessionToArchive.id.slice(0, 8)}`;
      await archiveSession(sessionToArchive.id);
      setSessionToArchive(null);
      setArchiveToast(`Session "${sessionName}" archived`);
      // Clear toast after 3 seconds
      setTimeout(() => setArchiveToast(null), 3000);
    } catch (err) {
      console.error('Failed to archive session:', err);
      setArchiveToast(`Failed to archive: ${(err as Error).message}`);
      setTimeout(() => setArchiveToast(null), 3000);
    } finally {
      setArchivingSession(false);
    }
  };

  // API key handlers
  const handleSaveApiKey = async () => {
    if (!apiKeyInput.trim()) return;
    
    setApiKeyStatus('saving');
    setApiKeyMessage(null);
    
    try {
      await setApiKey(apiKeyInput.trim());
      setApiKeyInput('');
      setApiKeyMessage({ type: 'success', text: 'API key saved successfully' });
    } catch (err) {
      setApiKeyMessage({ type: 'error', text: (err as Error).message });
    } finally {
      setApiKeyStatus('idle');
    }
  };

  const handleTestApiKey = async () => {
    setApiKeyStatus('testing');
    setApiKeyMessage(null);
    
    try {
      // Test with input if provided, otherwise test stored key
      const result = await testApiKey(apiKeyInput.trim() || undefined);
      setApiKeyMessage({ 
        type: result.valid ? 'success' : 'error', 
        text: result.message 
      });
    } catch (err) {
      setApiKeyMessage({ type: 'error', text: (err as Error).message });
    } finally {
      setApiKeyStatus('idle');
    }
  };

  const handleRemoveApiKey = async () => {
    if (!confirm('Are you sure you want to remove the API key?')) return;
    
    setApiKeyStatus('removing');
    setApiKeyMessage(null);
    
    try {
      await removeApiKey();
      setApiKeyMessage({ type: 'success', text: 'API key removed' });
    } catch (err) {
      setApiKeyMessage({ type: 'error', text: (err as Error).message });
    } finally {
      setApiKeyStatus('idle');
    }
  };

  // Copy invite link to clipboard
  const handleCopyInviteLink = async () => {
    if (!workspace?.joinCode) return;
    
    const { protocol, hostname, port } = window.location;
    const baseUrl = `${protocol}//${hostname}${port ? ':' + port : ''}`;
    const inviteLink = `${baseUrl}/join/${workspace.joinCode}`;
    
    try {
      await navigator.clipboard.writeText(inviteLink);
      setInviteLinkError(false);
      setInviteLinkCopied(true);
      setTimeout(() => setInviteLinkCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy invite link:', err);
      setInviteLinkCopied(false);
      setInviteLinkError(true);
      setTimeout(() => setInviteLinkError(false), 3000);
    }
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
          <div className="workspace-dropdown-container" ref={dropdownRef}>
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
          
          {removeDeviceMessage?.type === 'success' && (
            <div className="device-message success">
              {removeDeviceMessage.text}
            </div>
          )}
          
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
                  {workspace?.isOwner && !device.isCurrentDevice && (
                    <button 
                      className="remove-device-btn" 
                      onClick={() => handleRemoveDeviceClick(device)}
                      title="Remove device from workspace"
                    >
                      🗑️
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </section>

        {/* Device Removal Confirmation Dialog */}
        {deviceToRemove && (
          <div className="modal-overlay" onClick={handleCancelRemoveDevice}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
              <h3>Remove Device</h3>
              <p>
                Are you sure you want to remove <strong>{deviceToRemove.name}</strong> from this workspace?
              </p>
              <p className="modal-warning">
                The device will be disconnected immediately and must rejoin via QR code or invite link.
              </p>
              {removeDeviceMessage?.type === 'error' && (
                <p className="modal-error">{removeDeviceMessage.text}</p>
              )}
              <div className="modal-actions">
                <button 
                  className="modal-btn cancel"
                  onClick={handleCancelRemoveDevice}
                  disabled={removingDevice}
                >
                  Cancel
                </button>
                <button 
                  className="modal-btn danger"
                  onClick={handleConfirmRemoveDevice}
                  disabled={removingDevice}
                >
                  {removingDevice ? 'Removing...' : 'Remove Device'}
                </button>
              </div>
            </div>
          </div>
        )}

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
                    {editingSessionId === session.id ? (
                      <EditableSessionName 
                        session={session} 
                        onRename={async (id, name) => {
                          await renameSession(id, name);
                          setEditingSessionId(null);
                        }} 
                      />
                    ) : (
                      <span className="session-name-text" onClick={() => setEditingSessionId(session.id)}>
                        {session.name || `Session ${session.id.slice(0, 8)}`}
                        <button className="rename-btn" title="Rename session">✏️</button>
                      </span>
                    )}
                    <span className="session-meta">
                      Created {formatTime(session.startedAt)}
                    </span>
                  </div>
                  <span className="session-last-active">
                    {formatRelativeTime(session.lastActiveAt)}
                  </span>
                  <SessionKebabMenu 
                    onArchive={() => handleArchiveClick(session)}
                    onRenameClick={() => setEditingSessionId(session.id)}
                  />
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

          {/* Archive toast notification */}
          {archiveToast && (
            <div className="archive-toast">
              {archiveToast}
            </div>
          )}
        </section>

        {/* Session Archive Confirmation Dialog */}
        {sessionToArchive && (
          <div className="modal-overlay" onClick={handleCancelArchive}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
              <h3>Archive Session</h3>
              <p>
                Archive <strong>{sessionToArchive.name || `Session ${sessionToArchive.id.slice(0, 8)}`}</strong>?
              </p>
              <p className="modal-hint">
                The session will be hidden from your session list. Session data will be preserved.
              </p>
              <div className="modal-actions">
                <button
                  className="modal-btn cancel"
                  onClick={handleCancelArchive}
                  disabled={archivingSession}
                >
                  Cancel
                </button>
                <button
                  className="modal-btn primary"
                  onClick={handleConfirmArchive}
                  disabled={archivingSession}
                >
                  {archivingSession ? 'Archiving...' : 'Archive'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Settings Section (for owners) */}
        {workspace.isOwner && (
          <section className="settings-section">
            <h2>
              <span className="section-icon">⚙️</span>
              Settings
            </h2>
            <div className="settings-content">
              {/* Invite Link */}
              {workspace.joinCode && (
                <div className="setting-row invite-link-setting">
                  <label>Invite Link</label>
                  <div className="invite-link-row">
                    <button 
                      className={`copy-invite-btn ${inviteLinkCopied ? 'copied' : ''} ${inviteLinkError ? 'error' : ''}`}
                      onClick={handleCopyInviteLink}
                    >
                      {inviteLinkCopied ? '✓ Copied!' : inviteLinkError ? '✗ Copy failed' : '📋 Copy Invite Link'}
                    </button>
                  </div>
                  <span className="setting-hint">
                    Share this link to let others join your workspace. 
                    The link uses the workspace join code.
                  </span>
                </div>
              )}
              
              {/* OpenHands API Key */}
              <div className="setting-row api-key-setting">
                <label>OpenHands API Key</label>
                <div className="api-key-status">
                  {settings?.hasApiKey ? (
                    <span className="status-configured">✓ Configured</span>
                  ) : (
                    <span className="status-not-configured">⚠️ Not Configured</span>
                  )}
                </div>
                <div className="api-key-input-row">
                  <input
                    type="password"
                    placeholder={settings?.hasApiKey ? '••••••••••••••••' : 'Enter your OpenHands API key'}
                    value={apiKeyInput}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                    disabled={apiKeyStatus !== 'idle'}
                    className="api-key-input"
                  />
                  <button
                    onClick={handleSaveApiKey}
                    disabled={apiKeyStatus !== 'idle' || !apiKeyInput.trim()}
                    className="api-key-btn save-btn"
                  >
                    {apiKeyStatus === 'saving' ? 'Saving...' : 'Save'}
                  </button>
                  <button
                    onClick={handleTestApiKey}
                    disabled={apiKeyStatus !== 'idle' || (!apiKeyInput.trim() && !settings?.hasApiKey)}
                    className="api-key-btn test-btn"
                  >
                    {apiKeyStatus === 'testing' ? 'Testing...' : 'Test'}
                  </button>
                  {settings?.hasApiKey && (
                    <button
                      onClick={handleRemoveApiKey}
                      disabled={apiKeyStatus !== 'idle'}
                      className="api-key-btn remove-btn"
                    >
                      {apiKeyStatus === 'removing' ? 'Removing...' : 'Remove'}
                    </button>
                  )}
                </div>
                {apiKeyMessage && (
                  <div className={`api-key-message ${apiKeyMessage.type}`}>
                    {apiKeyMessage.text}
                  </div>
                )}
                <span className="setting-hint">
                  Your OpenHands Cloud API key for AI-powered conversations. 
                  Get one at <a href="https://app.all-hands.dev" target="_blank" rel="noopener noreferrer">app.all-hands.dev</a>
                </span>
              </div>
            </div>
          </section>
        )}
      </main>
      {version && (
        <footer className="version-footer">
          v. {version}
        </footer>
      )}
    </div>
  );
}
