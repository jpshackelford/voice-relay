/**
 * Server-driven WebSocket keepalive heartbeat (issue #286).
 *
 * Why: idle WebSocket connections between kiosk and server can be silently
 * terminated by intermediary proxies (Apache `ProxyTimeout`, Cloudflare,
 * ngrok, etc.) once they sit quiet for ~60 s. When this happens the user
 * sees the red-dot/reconnect path shipped in #285. Sending a small
 * protocol-level ping every 25 s keeps proxies happy and gives the server
 * a way to detect dead clients (frozen tabs, NAT timeouts, broken TCP)
 * within roughly one heartbeat-deadline window.
 *
 * How: we use WebSocket protocol-level ping/pong frames (RFC 6455 §5.5)
 * rather than JSON application messages. Browsers automatically respond to
 * a server-sent ping with a pong frame at the protocol layer (verified
 * across Chrome/Firefox/Safari WebKit), so this requires zero client code
 * to keep the connection alive. The server tracks a per-connection
 * `isAlive` flag; if a heartbeat cycle elapses without a pong, the
 * connection is terminated and existing `close` handlers run normally.
 */

import type { WebSocket } from 'ws';

/** How often the server sends a ping frame to each open WS. */
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 25_000;

/**
 * How long the server waits for a pong before assuming the peer is dead.
 *
 * Implemented as a "no-pong-since-last-ping" check on the next interval
 * tick, which means in steady state a frozen client is terminated within
 * `2 * intervalMs` of going silent (one tick to ping, one tick to detect).
 * Default cadence (25 s + 25 s = 50 s) sits comfortably under the typical
 * 60 s proxy idle threshold.
 */
export const DEFAULT_HEARTBEAT_DEADLINE_MS = 25_000;

/**
 * Optional knobs for `attachKeepalive`. All fields are optional; defaults
 * are the constants exported above. The injectable scheduler exists so
 * tests can drive the loop with a fake clock without resorting to global
 * timer mocks when they prefer not to.
 */
export interface KeepaliveOptions {
  /** Interval between server-initiated pings, in ms. Defaults to 25 000. */
  intervalMs?: number;
  /**
   * Custom scheduler. Defaults to global `setInterval`/`clearInterval`.
   * Tests that want to avoid `vi.useFakeTimers()` can pass a fake here.
   */
  setInterval?: (fn: () => void, ms: number) => ReturnType<typeof setInterval>;
  clearInterval?: (handle: ReturnType<typeof setInterval>) => void;
  /**
   * Optional callback fired right before a stale connection is terminated.
   * Lets callers add logging without coupling this helper to a logger.
   */
  onTerminate?: () => void;
}

/**
 * Attach a periodic ping/pong liveness check to a single WebSocket.
 *
 * Returns a teardown function. It is also wired to `ws.on('close')` so
 * that callers who forget to call it still get the interval cleared
 * automatically — calling it twice is a no-op.
 *
 * Behaviour:
 *   - Sends `ws.ping()` every `intervalMs` (default 25 s).
 *   - Listens for the `'pong'` event; resets the per-connection
 *     `isAlive` flag.
 *   - On each tick, if no pong has been received since the previous
 *     tick, the connection is terminated (`ws.terminate()`) and the
 *     interval is cleared. `terminate()` skips the closing handshake,
 *     which is intentional: a peer that never sent a pong is unlikely
 *     to acknowledge a close frame either.
 *   - On `close` (graceful or terminate-driven), the interval is
 *     cleared so it doesn't fire on a dead handle.
 *
 * Safe to call once per `wss.on('connection')` callback.
 */
export function attachKeepalive(
  ws: WebSocket,
  options: KeepaliveOptions = {}
): () => void {
  const intervalMs = options.intervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
  const setIntervalFn = options.setInterval ?? setInterval;
  const clearIntervalFn = options.clearInterval ?? clearInterval;

  // `isAlive` is set true at start (connection just opened, presumed alive)
  // and on every received pong. The interval tick reads the value, takes
  // its decision, then resets to false so the *next* tick needs a fresh
  // pong to keep the connection. This is the same pattern documented in
  // the `ws` README under "How to detect and close broken connections".
  let isAlive = true;
  let torn = false;

  const onPong = () => {
    isAlive = true;
  };
  ws.on('pong', onPong);

  const handle = setIntervalFn(() => {
    if (!isAlive) {
      // No pong since the previous tick → peer is presumed dead.
      // terminate() fires 'close', which calls our teardown to clear
      // the interval. We still call cleanup defensively here in case
      // the 'close' handler doesn't fire (e.g., already-closed socket).
      options.onTerminate?.();
      try {
        ws.terminate();
      } catch {
        // Best-effort: socket may already be torn down.
      }
      cleanup();
      return;
    }
    isAlive = false;
    try {
      ws.ping();
    } catch {
      // ping() can throw if the underlying socket is half-closed.
      // Treat as a dead connection.
      options.onTerminate?.();
      try {
        ws.terminate();
      } catch {
        // ignored
      }
      cleanup();
    }
  }, intervalMs);

  // Node `setInterval` returns a Timeout that holds the event loop open.
  // Allow the process to exit during graceful shutdown even if a few WS
  // are still attached.
  (handle as { unref?: () => void }).unref?.();

  const cleanup = () => {
    if (torn) return;
    torn = true;
    clearIntervalFn(handle);
    ws.off('pong', onPong);
  };

  ws.on('close', cleanup);

  return cleanup;
}
