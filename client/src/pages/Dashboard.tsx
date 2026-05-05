import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, getWorkspaces, createWorkspace, deleteWorkspace, regenerateJoinCode, type Workspace } from '../auth';

export function Dashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const loadWorkspaces = useCallback(async () => {
    try {
      setError(null);
      const data = await getWorkspaces();
      setWorkspaces(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadWorkspaces();
  }, [loadWorkspaces]);

  const handleCreateWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWorkspaceName.trim()) return;

    setIsCreating(true);
    try {
      const workspace = await createWorkspace({ name: newWorkspaceName.trim() });
      setWorkspaces(prev => [workspace, ...prev]);
      setNewWorkspaceName('');
      setShowCreateForm(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteWorkspace = async (workspace: Workspace) => {
    if (!confirm(`Delete workspace "${workspace.name}"? This cannot be undone.`)) return;

    try {
      await deleteWorkspace(workspace.id);
      setWorkspaces(prev => prev.filter(w => w.id !== workspace.id));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleRegenerateJoinCode = async (workspace: Workspace) => {
    try {
      const newCode = await regenerateJoinCode(workspace.id);
      setWorkspaces(prev =>
        prev.map(w => (w.id === workspace.id ? { ...w, joinCode: newCode } : w))
      );
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleJoinWorkspace = (workspace: Workspace) => {
    navigate(`/workspace/${workspace.slug}`);
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <div className="dashboard-title">
          <h1>🔊 Voice Relay</h1>
        </div>
        <div className="dashboard-user">
          {user?.avatarUrl && (
            <img src={user.avatarUrl} alt={user.username} className="user-avatar" />
          )}
          <span className="user-name">{user?.displayName || user?.username}</span>
          <button className="logout-btn" onClick={handleLogout}>
            Sign Out
          </button>
        </div>
      </header>

      <main className="dashboard-content">
        <div className="dashboard-section">
          <div className="section-header">
            <h2>Your Workspaces</h2>
            <button
              className="create-workspace-btn"
              onClick={() => setShowCreateForm(!showCreateForm)}
            >
              {showCreateForm ? 'Cancel' : '+ New Workspace'}
            </button>
          </div>

          {error && (
            <div className="dashboard-error">
              ⚠️ {error}
              <button onClick={() => setError(null)}>✕</button>
            </div>
          )}

          {showCreateForm && (
            <form className="create-workspace-form" onSubmit={handleCreateWorkspace}>
              <input
                type="text"
                value={newWorkspaceName}
                onChange={e => setNewWorkspaceName(e.target.value)}
                placeholder="Workspace name"
                autoFocus
                disabled={isCreating}
              />
              <button type="submit" disabled={!newWorkspaceName.trim() || isCreating}>
                {isCreating ? 'Creating...' : 'Create'}
              </button>
            </form>
          )}

          {isLoading ? (
            <div className="loading">Loading workspaces...</div>
          ) : workspaces.length === 0 ? (
            <div className="no-workspaces">
              <p>You don't have any workspaces yet.</p>
              <p>Create one to get started!</p>
            </div>
          ) : (
            <div className="workspace-list">
              {workspaces.map(workspace => (
                <div key={workspace.id} className="workspace-card">
                  <div className="workspace-info">
                    <h3>{workspace.name}</h3>
                    <span className="workspace-slug">/{workspace.slug}</span>
                    {workspace.isOwner && <span className="owner-badge">Owner</span>}
                  </div>

                  <div className="workspace-join-code">
                    <span className="join-code-label">Join Code:</span>
                    <code className="join-code">{workspace.joinCode || 'N/A'}</code>
                    {workspace.isOwner && workspace.joinCode && (
                      <button
                        className="regenerate-btn"
                        onClick={() => handleRegenerateJoinCode(workspace)}
                        title="Generate new join code"
                      >
                        🔄
                      </button>
                    )}
                  </div>

                  <div className="workspace-actions">
                    <button
                      className="join-btn"
                      onClick={() => handleJoinWorkspace(workspace)}
                    >
                      Connect
                    </button>
                    {workspace.isOwner && (
                      <button
                        className="delete-btn"
                        onClick={() => handleDeleteWorkspace(workspace)}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
