import type { User, Workspace } from './types';
import { getStoredToken } from './storage';

const API_BASE = '';

// E2E test mode - mock API responses
const isE2EMode = import.meta.env.VITE_E2E_MODE === 'true';

// Mock data for E2E tests
const E2E_MOCK_WORKSPACE: Workspace = {
  id: 'e2e-test-workspace',
  name: 'Test Workspace',
  slug: 'test',
  ownerId: 'e2e-test-user',
  joinCode: 'test-join-code',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

async function fetchWithAuth<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  const headers = new Headers(options.headers);
  
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  headers.set('Content-Type', 'application/json');
  
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }
  
  return response.json();
}

export async function getCurrentUser(): Promise<User> {
  const data = await fetchWithAuth<{ user: User }>('/auth/me');
  return data.user;
}

export async function logout(): Promise<void> {
  await fetchWithAuth<{ success: boolean }>('/auth/logout', { method: 'POST' });
}

export async function getWorkspaces(): Promise<Workspace[]> {
  // In E2E mode, return mock workspace
  if (isE2EMode) {
    return [E2E_MOCK_WORKSPACE];
  }
  const data = await fetchWithAuth<{ workspaces: Workspace[] }>('/api/workspaces');
  return data.workspaces;
}

export async function getWorkspace(id: string): Promise<Workspace> {
  // In E2E mode, return mock workspace if ID matches
  if (isE2EMode && (id === E2E_MOCK_WORKSPACE.id || id === 'default')) {
    return E2E_MOCK_WORKSPACE;
  }
  const data = await fetchWithAuth<{ workspace: Workspace }>(`/api/workspaces/${id}`);
  return data.workspace;
}

export async function getWorkspaceBySlug(slug: string): Promise<Workspace> {
  // In E2E mode, return mock workspace if slug matches
  if (isE2EMode && (slug === E2E_MOCK_WORKSPACE.slug || slug === 'test')) {
    return E2E_MOCK_WORKSPACE;
  }
  const data = await fetchWithAuth<{ workspace: Workspace }>(`/api/workspaces/by-slug/${slug}`);
  return data.workspace;
}

export async function getWorkspaceByJoinCode(joinCode: string): Promise<Workspace> {
  const data = await fetchWithAuth<{ workspace: Workspace }>(`/api/workspaces/join/${joinCode}`);
  return data.workspace;
}

export interface CreateWorkspaceInput {
  name: string;
  slug?: string;
}

export async function createWorkspace(input: CreateWorkspaceInput): Promise<Workspace> {
  const data = await fetchWithAuth<{ workspace: Workspace }>('/api/workspaces', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return data.workspace;
}

export async function deleteWorkspace(id: string): Promise<void> {
  await fetchWithAuth<{ success: boolean }>(`/api/workspaces/${id}`, {
    method: 'DELETE',
  });
}

export async function regenerateJoinCode(id: string): Promise<string> {
  const data = await fetchWithAuth<{ joinCode: string }>(
    `/api/workspaces/${id}/join-code`,
    { method: 'POST' }
  );
  return data.joinCode;
}

export async function joinWorkspace(joinCode: string): Promise<Workspace> {
  const data = await fetchWithAuth<{ workspace: Workspace }>(
    `/api/workspaces/join/${joinCode}/member`,
    { method: 'POST' }
  );
  return data.workspace;
}
