import { FullConfig } from '@playwright/test';
import { spawn, ChildProcess } from 'child_process';
import { writeFileSync, mkdirSync, existsSync, unlinkSync } from 'fs';
import { join } from 'path';

/**
 * Global setup for parallel E2E tests.
 *
 * Spawns N server instances before any tests run, where each worker gets:
 * - Unique client port (CLIENT_BASE + workerIndex * 10)
 * - Unique server port (SERVER_BASE + workerIndex * 10)
 * - Unique SQLite database (./data/test-worker-{workerIndex}.db)
 *
 * Port mapping is written to a temp file for teardown and worker fixtures.
 *
 * GitHub Issue: #155
 */

// Port allocation constants
const CLIENT_BASE_PORT = 5174;
const SERVER_BASE_PORT = 3002;
const PORT_SPACING = 10;

// Environment variables
const TEST_AUTH_SECRET = process.env.TEST_AUTH_SECRET || '';
const JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-local-dev-only';

// Temp file location for worker port mapping
const DATA_DIR = join(process.cwd(), 'data');
const WORKER_PORTS_FILE = join(DATA_DIR, 'test-worker-ports.json');

interface WorkerInfo {
  clientPort: number;
  serverPort: number;
  dbPath: string;
  serverPid: number;
  clientPid: number;
}

interface WorkerPortsConfig {
  workers: WorkerInfo[];
  startedAt: string;
}

/**
 * Sleep helper
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Wait for a server to be ready by polling its health endpoint.
 */
async function waitForServer(port: number, timeout = 30000): Promise<void> {
  const start = Date.now();
  const healthUrl = `http://localhost:${port}/health`;

  while (Date.now() - start < timeout) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);

      const res = await fetch(healthUrl, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (res.ok) {
        return;
      }
    } catch {
      // Server not ready yet, continue polling
    }
    await sleep(500);
  }
  throw new Error(`Server on port ${port} did not start within ${timeout}ms`);
}

/**
 * Wait for client dev server to be ready by polling its URL.
 */
async function waitForClient(port: number, timeout = 60000): Promise<void> {
  const start = Date.now();
  const clientUrl = `http://localhost:${port}`;

  while (Date.now() - start < timeout) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);

      const res = await fetch(clientUrl, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (res.ok || res.status === 304) {
        return;
      }
    } catch {
      // Client not ready yet, continue polling
    }
    await sleep(500);
  }
  throw new Error(`Client on port ${port} did not start within ${timeout}ms`);
}

/**
 * Spawn a server process for a worker.
 */
function spawnServer(workerIndex: number, serverPort: number, dbPath: string): ChildProcess {
  const env = {
    ...process.env,
    PORT: String(serverPort),
    STORE_DRIVER: 'sqlite',
    SQLITE_PATH: dbPath,
    TEST_AUTH_SECRET,
    JWT_SECRET,
  };

  const proc = spawn('npm', ['run', 'dev', '-w', 'server'], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });

  // Log server output for debugging
  proc.stdout?.on('data', (data) => {
    if (process.env.DEBUG_GLOBAL_SETUP) {
      console.log(`[server-${workerIndex}] ${data.toString().trim()}`);
    }
  });

  proc.stderr?.on('data', (data) => {
    if (process.env.DEBUG_GLOBAL_SETUP) {
      console.error(`[server-${workerIndex}] ${data.toString().trim()}`);
    }
  });

  return proc;
}

/**
 * Spawn a client dev server process for a worker.
 */
function spawnClient(workerIndex: number, clientPort: number, serverPort: number): ChildProcess {
  const env = {
    ...process.env,
    VITE_WS_PORT: String(serverPort),
  };

  const proc = spawn('npm', ['run', 'dev', '-w', 'client', '--', '--port', String(clientPort)], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });

  // Log client output for debugging
  proc.stdout?.on('data', (data) => {
    if (process.env.DEBUG_GLOBAL_SETUP) {
      console.log(`[client-${workerIndex}] ${data.toString().trim()}`);
    }
  });

  proc.stderr?.on('data', (data) => {
    if (process.env.DEBUG_GLOBAL_SETUP) {
      console.error(`[client-${workerIndex}] ${data.toString().trim()}`);
    }
  });

  return proc;
}

/**
 * Clean up any stale test databases from previous runs.
 */
function cleanupStaleTestDatabases(workerCount: number): void {
  for (let i = 0; i < workerCount; i++) {
    const dbPath = join(DATA_DIR, `test-worker-${i}.db`);
    const walPath = `${dbPath}-wal`;
    const shmPath = `${dbPath}-shm`;

    for (const path of [dbPath, walPath, shmPath]) {
      if (existsSync(path)) {
        try {
          unlinkSync(path);
        } catch (e) {
          console.warn(`Could not remove ${path}: ${e}`);
        }
      }
    }
  }
}

/**
 * Global setup function called before any tests run.
 */
async function globalSetup(config: FullConfig): Promise<void> {
  // Determine worker count from config or environment
  const workerCount = parseInt(process.env.PLAYWRIGHT_WORKERS || '4', 10);
  console.log(`[global-setup] Starting ${workerCount} worker servers...`);

  // Ensure data directory exists
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }

  // Clean up stale databases from previous runs
  cleanupStaleTestDatabases(workerCount);

  const workers: WorkerInfo[] = [];
  const processes: { server: ChildProcess; client: ChildProcess }[] = [];
  const startupErrors: Error[] = [];

  try {
    // Spawn servers and clients for each worker
    for (let i = 0; i < workerCount; i++) {
      const clientPort = CLIENT_BASE_PORT + i * PORT_SPACING;
      const serverPort = SERVER_BASE_PORT + i * PORT_SPACING;
      const dbPath = join(DATA_DIR, `test-worker-${i}.db`);

      console.log(`[global-setup] Worker ${i}: client=${clientPort}, server=${serverPort}, db=${dbPath}`);

      const serverProc = spawnServer(i, serverPort, dbPath);
      const clientProc = spawnClient(i, clientPort, serverPort);

      // Fail fast if processes exit unexpectedly during startup
      serverProc.on('exit', (code) => {
        if (code !== null && code !== 0) {
          const error = new Error(`Server ${i} exited with code ${code}`);
          console.error(`[global-setup] ${error.message}`);
          startupErrors.push(error);
        }
      });
      clientProc.on('exit', (code) => {
        if (code !== null && code !== 0) {
          const error = new Error(`Client ${i} exited with code ${code}`);
          console.error(`[global-setup] ${error.message}`);
          startupErrors.push(error);
        }
      });

      processes.push({ server: serverProc, client: clientProc });

      workers.push({
        clientPort,
        serverPort,
        dbPath,
        serverPid: serverProc.pid || 0,
        clientPid: clientProc.pid || 0,
      });
    }

    // Check for early startup failures before waiting for health checks
    await sleep(500);
    if (startupErrors.length > 0) {
      throw new Error(`Process startup failed: ${startupErrors.map(e => e.message).join(', ')}`);
    }

    // Wait for all servers to be ready
    console.log('[global-setup] Waiting for servers to be ready...');
    const serverWaits = workers.map((w, i) =>
      waitForServer(w.serverPort).then(() => {
        console.log(`[global-setup] Server ${i} ready on port ${w.serverPort}`);
      })
    );

    // Wait for all clients to be ready (longer timeout for Vite)
    const clientWaits = workers.map((w, i) =>
      waitForClient(w.clientPort).then(() => {
        console.log(`[global-setup] Client ${i} ready on port ${w.clientPort}`);
      })
    );

    await Promise.all([...serverWaits, ...clientWaits]);

    // Write port mapping to temp file
    const config: WorkerPortsConfig = {
      workers,
      startedAt: new Date().toISOString(),
    };
    writeFileSync(WORKER_PORTS_FILE, JSON.stringify(config, null, 2));
    console.log(`[global-setup] Port mapping written to ${WORKER_PORTS_FILE}`);

    console.log('[global-setup] All worker servers ready!');
  } catch (error) {
    console.error('[global-setup] Failed to start servers:', error);

    // Kill any spawned processes on failure
    for (const { server, client } of processes) {
      try {
        server.kill('SIGTERM');
        client.kill('SIGTERM');
      } catch {
        // Ignore kill errors
      }
    }

    throw error;
  }
}

export default globalSetup;
