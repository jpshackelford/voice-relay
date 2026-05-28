import { useCallback, useEffect, useState } from 'react';

/**
 * Public, anonymous-safe slice of a workspace's settings that the kiosk UI
 * needs to render itself (issue #340).
 *
 * Today this is only the footer-ticker toggle. Anything added here MUST be
 * safe to expose without authentication.
 */
export interface KioskConfig {
  workspaceId: string;
  kioskFooterTickersEnabled: boolean;
}

interface UseKioskConfigReturn {
  config: KioskConfig | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * Fetches the public kiosk config for a workspace.
 *
 * Kiosks are not authenticated as a user, so the owner-only
 * `/api/workspaces/:id/settings` endpoint is unavailable. The server exposes
 * a narrower no-auth `kiosk-config` endpoint that just returns this slice.
 */
export function useKioskConfig(workspaceId: string | undefined): UseKioskConfigReturn {
  const [config, setConfig] = useState<KioskConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!workspaceId) {
      setConfig(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/kiosk-config`, {
        // No `credentials: 'include'` needed — endpoint is anonymous, and we
        // don't want a stale-cookie failure to mask a legitimate fetch.
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        throw new Error(`Failed to fetch kiosk config (HTTP ${res.status})`);
      }
      const data = (await res.json()) as KioskConfig;
      setConfig(data);
    } catch (err) {
      setError((err as Error).message);
      // Don't clobber any previously-fetched config on transient failure.
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { config, loading, error, refresh };
}
