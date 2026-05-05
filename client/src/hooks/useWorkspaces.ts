import { useState, useCallback, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';

export interface Workspace {
  id: string;
  ownerId: string;
  name: string;
  slug: string;
  joinCode: string | null;
  createdAt: string;
  updatedAt: string | null;
  isOwner: boolean;
}

interface UseWorkspacesReturn {
  workspaces: Workspace[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  createWorkspace: (name: string) => Promise<Workspace>;
  deleteWorkspace: (id: string) => Promise<void>;
  joinWorkspace: (code: string) => Promise<Workspace>;
}

export function useWorkspaces(): UseWorkspacesReturn {
  const { isAuthenticated } = useAuth();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isAuthenticated) {
      setWorkspaces([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/workspaces', {
        credentials: 'include', // Include httpOnly cookies
        headers: { 'Content-Type': 'application/json' },
      });
      
      if (!res.ok) {
        throw new Error('Failed to fetch workspaces');
      }
      
      const data = await res.json();
      setWorkspaces(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const createWorkspace = useCallback(async (name: string): Promise<Workspace> => {
    const res = await fetch('/api/workspaces', {
      method: 'POST',
      credentials: 'include', // Include httpOnly cookies
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to create workspace');
    }

    const workspace = await res.json();
    setWorkspaces(prev => [workspace, ...prev]);
    return workspace;
  }, []);

  const deleteWorkspace = useCallback(async (id: string): Promise<void> => {
    const res = await fetch(`/api/workspaces/${id}`, {
      method: 'DELETE',
      credentials: 'include', // Include httpOnly cookies
      headers: { 'Content-Type': 'application/json' },
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to delete workspace');
    }

    setWorkspaces(prev => prev.filter(w => w.id !== id));
  }, []);

  const joinWorkspace = useCallback(async (code: string): Promise<Workspace> => {
    const res = await fetch('/api/workspaces/join', {
      method: 'POST',
      credentials: 'include', // Include httpOnly cookies
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to join workspace');
    }

    const workspace = await res.json();
    // Check if already in list
    setWorkspaces(prev => {
      if (prev.some(w => w.id === workspace.id)) {
        return prev;
      }
      return [workspace, ...prev];
    });
    return workspace;
  }, []);

  return {
    workspaces,
    loading,
    error,
    refresh,
    createWorkspace,
    deleteWorkspace,
    joinWorkspace,
  };
}
