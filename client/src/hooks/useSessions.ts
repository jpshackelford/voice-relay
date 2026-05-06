import { useState, useCallback, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';

export interface SessionSummary {
  id: string;
  workspaceId: string;
  name: string | null;
  status: 'active' | 'ended' | 'archived';
  startedAt: string;
  deviceCount: number;
  lastActiveAt: string;
}

interface UseSessionsReturn {
  sessions: SessionSummary[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  createSession: (name?: string) => Promise<SessionSummary>;
}

export function useSessions(workspaceId: string | undefined): UseSessionsReturn {
  const { isAuthenticated } = useAuth();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isAuthenticated || !workspaceId) {
      setSessions([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/sessions`, {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      
      if (!res.ok) {
        throw new Error('Failed to fetch sessions');
      }
      
      const data = await res.json();
      setSessions(data.sessions || []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, workspaceId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const createSession = useCallback(async (name?: string): Promise<SessionSummary> => {
    if (!workspaceId) {
      throw new Error('No workspace selected');
    }

    const res = await fetch(`/api/workspaces/${workspaceId}/sessions`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to create session');
    }

    const data = await res.json();
    const session = data.session;
    
    // Add to sessions list with lastActiveAt (will be startedAt for new session)
    const newSession: SessionSummary = {
      ...session,
      deviceCount: 0,
      lastActiveAt: session.startedAt,
    };
    setSessions(prev => [newSession, ...prev]);
    return newSession;
  }, [workspaceId]);

  return {
    sessions,
    loading,
    error,
    refresh,
    createSession,
  };
}
