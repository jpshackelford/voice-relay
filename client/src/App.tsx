import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { WorkspaceHome } from './pages/WorkspaceHome';
import { Workspace } from './pages/Workspace';
import { useWorkspaces } from './hooks/useWorkspaces';
import './App.css';

// Protected route wrapper
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="loading-page">
        <div className="loading-spinner">Loading...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

// Auto-redirect to default workspace
function DefaultWorkspaceRedirect() {
  const { workspaces, loading } = useWorkspaces();

  if (loading) {
    return (
      <div className="loading-page">
        <div className="loading-spinner">Loading workspace...</div>
      </div>
    );
  }

  // If user has workspaces, redirect to the first one
  if (workspaces.length > 0) {
    return <Navigate to={`/workspace/${workspaces[0].id}`} replace />;
  }

  // Fall back to legacy dashboard if no workspaces (shouldn't happen with auto-create)
  return <Dashboard />;
}

// Main App with routing
function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <DefaultWorkspaceRedirect />
          </ProtectedRoute>
        }
      />
      <Route
        path="/workspace/:workspaceId"
        element={
          <ProtectedRoute>
            <WorkspaceHome />
          </ProtectedRoute>
        }
      />
      <Route
        path="/workspace/:workspaceId/session"
        element={
          <ProtectedRoute>
            <Workspace />
          </ProtectedRoute>
        }
      />
      {/* Redirect root to dashboard (which will auto-redirect to default workspace) */}
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      {/* Catch-all redirect */}
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
