import { test as base, expect } from '@playwright/test';

/**
 * Worker-scoped fixtures for parallel E2E tests.
 *
 * Each Playwright worker gets unique ports derived from its workerIndex:
 * - clientPort: 5174 + (workerIndex % WORKER_COUNT * 10)
 * - serverPort: 3002 + (workerIndex % WORKER_COUNT * 10)
 *
 * The workerIndex is wrapped using modulo because Playwright's workerIndex
 * can exceed the configured worker count when tests are distributed across files.
 *
 * These fixtures expose the worker's ports and baseURL for test files.
 *
 * GitHub Issue: #155
 */

// Port allocation constants (must match global-setup.ts)
const CLIENT_BASE_PORT = 5174;
const SERVER_BASE_PORT = 3002;
const PORT_SPACING = 10;

// Get worker count from environment (must match global-setup.ts)
const WORKER_COUNT = parseInt(process.env.PLAYWRIGHT_WORKERS || '4', 10);

// Export expect for convenience
export { expect };

/**
 * Worker-scoped fixtures for parallel test execution.
 */
export const test = base.extend<
  object,
  {
    workerClientPort: number;
    workerServerPort: number;
    workerBaseURL: string;
  }
>({
  /**
   * Client port for this worker.
   * Calculated as: 5174 + ((workerIndex % WORKER_COUNT) * 10)
   */
  workerClientPort: [
    async ({}, use, workerInfo) => {
      const wrappedIndex = workerInfo.workerIndex % WORKER_COUNT;
      const port = CLIENT_BASE_PORT + wrappedIndex * PORT_SPACING;
      await use(port);
    },
    { scope: 'worker' },
  ],

  /**
   * Server port for this worker.
   * Calculated as: 3002 + ((workerIndex % WORKER_COUNT) * 10)
   */
  workerServerPort: [
    async ({}, use, workerInfo) => {
      const wrappedIndex = workerInfo.workerIndex % WORKER_COUNT;
      const port = SERVER_BASE_PORT + wrappedIndex * PORT_SPACING;
      await use(port);
    },
    { scope: 'worker' },
  ],

  /**
   * Base URL for this worker's client.
   * Overrides the page context's baseURL.
   */
  workerBaseURL: [
    async ({ workerClientPort }, use) => {
      const baseURL = `http://localhost:${workerClientPort}`;
      await use(baseURL);
    },
    { scope: 'worker' },
  ],

  /**
   * Override the page fixture to use worker-specific baseURL.
   */
  page: async ({ page, workerBaseURL }, use) => {
    // Override the baseURL for navigation
    // Note: page.goto will use this as the base for relative URLs
    const originalGoto = page.goto.bind(page);
    page.goto = async (url: string, options?: Parameters<typeof page.goto>[1]) => {
      // If URL is relative, prepend worker baseURL
      if (url.startsWith('/')) {
        return originalGoto(`${workerBaseURL}${url}`, options);
      }
      return originalGoto(url, options);
    };

    // Also override context().baseURL for tests that read it
    const originalContext = page.context();
    Object.defineProperty(originalContext, 'baseURL', {
      get: () => workerBaseURL,
    });

    await use(page);
  },

  /**
   * Override the request fixture to use worker-specific baseURL.
   */
  request: async ({ request, workerBaseURL }, use) => {
    // Create a wrapper that adds the worker baseURL to relative URLs
    const wrappedRequest = {
      ...request,
      get: async (url: string, options?: Parameters<typeof request.get>[1]) => {
        const fullUrl = url.startsWith('/') ? `${workerBaseURL}${url}` : url;
        return request.get(fullUrl, options);
      },
      post: async (url: string, options?: Parameters<typeof request.post>[1]) => {
        const fullUrl = url.startsWith('/') ? `${workerBaseURL}${url}` : url;
        return request.post(fullUrl, options);
      },
      delete: async (url: string, options?: Parameters<typeof request.delete>[1]) => {
        const fullUrl = url.startsWith('/') ? `${workerBaseURL}${url}` : url;
        return request.delete(fullUrl, options);
      },
      put: async (url: string, options?: Parameters<typeof request.put>[1]) => {
        const fullUrl = url.startsWith('/') ? `${workerBaseURL}${url}` : url;
        return request.put(fullUrl, options);
      },
      patch: async (url: string, options?: Parameters<typeof request.patch>[1]) => {
        const fullUrl = url.startsWith('/') ? `${workerBaseURL}${url}` : url;
        return request.patch(fullUrl, options);
      },
      head: async (url: string, options?: Parameters<typeof request.head>[1]) => {
        const fullUrl = url.startsWith('/') ? `${workerBaseURL}${url}` : url;
        return request.head(fullUrl, options);
      },
      fetch: async (urlOrRequest: string | import('@playwright/test').Request, options?: Parameters<typeof request.fetch>[1]) => {
        if (typeof urlOrRequest === 'string' && urlOrRequest.startsWith('/')) {
          return request.fetch(`${workerBaseURL}${urlOrRequest}`, options);
        }
        return request.fetch(urlOrRequest, options);
      },
      dispose: () => request.dispose(),
      storageState: (options?: Parameters<typeof request.storageState>[0]) => request.storageState(options),
    };

    await use(wrappedRequest as typeof request);
  },
});
