import { FullConfig } from '@playwright/test';
import { readFileSync, existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

/**
 * Global teardown for parallel E2E tests.
 *
 * Cleans up server processes and temp files:
 * - Reads PID mapping from temp file
 * - Sends SIGTERM to each server/client process
 * - Removes temp databases if cleanup enabled
 *
 * GitHub Issue: #155
 */

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
 * Kill a process by PID with fallback to SIGKILL.
 */
function killProcess(pid: number, name: string): void {
  if (!pid || pid === 0) return;

  try {
    process.kill(pid, 'SIGTERM');
    console.log(`[global-teardown] Sent SIGTERM to ${name} (PID: ${pid})`);
  } catch (e: unknown) {
    // Process might already be dead
    const err = e as NodeJS.ErrnoException;
    if (err.code !== 'ESRCH') {
      console.warn(`[global-teardown] Could not kill ${name} (PID: ${pid}): ${e}`);
    }
  }
}

/**
 * Kill all processes listening on a specific port.
 * This is a fallback for processes that didn't get tracked properly.
 */
function killProcessOnPort(port: number): void {
  try {
    // Use lsof to find processes on the port
    const result = execSync(`lsof -ti:${port} 2>/dev/null || true`, { encoding: 'utf-8' });
    const pids = result.trim().split('\n').filter(Boolean);

    for (const pid of pids) {
      try {
        process.kill(parseInt(pid, 10), 'SIGKILL');
        console.log(`[global-teardown] Killed process on port ${port} (PID: ${pid})`);
      } catch {
        // Ignore errors
      }
    }
  } catch {
    // lsof might not be available
  }
}

/**
 * Remove a database file and its WAL/SHM files.
 */
function removeDatabase(dbPath: string): void {
  const files = [dbPath, `${dbPath}-wal`, `${dbPath}-shm`];

  for (const file of files) {
    if (existsSync(file)) {
      try {
        unlinkSync(file);
        console.log(`[global-teardown] Removed ${file}`);
      } catch (e) {
        console.warn(`[global-teardown] Could not remove ${file}: ${e}`);
      }
    }
  }
}

/**
 * Global teardown function called after all tests complete.
 */
async function globalTeardown(config: FullConfig): Promise<void> {
  console.log('[global-teardown] Cleaning up worker servers...');

  // Check if ports file exists
  if (!existsSync(WORKER_PORTS_FILE)) {
    console.log('[global-teardown] No worker ports file found, nothing to clean up');
    return;
  }

  let workerConfig: WorkerPortsConfig;
  try {
    const content = readFileSync(WORKER_PORTS_FILE, 'utf-8');
    workerConfig = JSON.parse(content);
  } catch (e) {
    console.error('[global-teardown] Failed to read worker ports file:', e);
    return;
  }

  // Kill all tracked processes
  for (let i = 0; i < workerConfig.workers.length; i++) {
    const worker = workerConfig.workers[i];

    // Kill tracked PIDs
    killProcess(worker.serverPid, `server-${i}`);
    killProcess(worker.clientPid, `client-${i}`);

    // Fallback: kill anything on the ports
    killProcessOnPort(worker.clientPort);
    killProcessOnPort(worker.serverPort);

    // Clean up database if CLEANUP_TEST_DBS is set
    if (process.env.CLEANUP_TEST_DBS === 'true') {
      removeDatabase(worker.dbPath);
    }
  }

  // Remove the worker ports file
  try {
    unlinkSync(WORKER_PORTS_FILE);
    console.log(`[global-teardown] Removed ${WORKER_PORTS_FILE}`);
  } catch (e) {
    console.warn(`[global-teardown] Could not remove ${WORKER_PORTS_FILE}: ${e}`);
  }

  // Give processes time to shut down gracefully
  await new Promise(resolve => setTimeout(resolve, 1000));

  console.log('[global-teardown] Cleanup complete');
}

export default globalTeardown;
