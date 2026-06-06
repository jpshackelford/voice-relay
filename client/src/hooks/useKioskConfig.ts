import { useCallback, useEffect, useState } from 'react';

/** STT engine selection — workspace default (issue #410). */
export type SttEngine = 'web-speech' | 'deepgram';

/**
 * Public, anonymous-safe slice of a workspace's settings that the kiosk UI
 * needs to render itself (issue #340).
 *
 * Anything added here MUST be safe to expose without authentication. The
 * `sttEngine` value is safe because the Deepgram API key never leaves the
 * server — hosted-STT sessions are gated independently by the auth'd
 * `POST /api/stt/token` broker.
 */
export interface KioskConfig {
  workspaceId: string;
  kioskFooterTickersEnabled: boolean;
  /**
   * Issue #410: workspace-default STT engine. The mode component then
   * resolves the effective engine as `device.config.stt_engine ??
   * sttEngine ?? 'web-speech'`. Older servers that don't populate this
   * field are treated as `'web-speech'` by the consumer.
   */
  sttEngine: SttEngine;
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
      const raw = (await res.json()) as Partial<KioskConfig>;
      // Normalize unknown `sttEngine` values (older servers, hand-edited
      // responses) to the safe default so consumers can rely on the type.
      const sttEngine: SttEngine = raw.sttEngine === 'deepgram' ? 'deepgram' : 'web-speech';
      setConfig({
        workspaceId: raw.workspaceId ?? workspaceId,
        kioskFooterTickersEnabled: !!raw.kioskFooterTickersEnabled,
        sttEngine,
      });
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
