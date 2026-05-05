import { test, expect } from '@playwright/test';

/**
 * Smoke tests for Voice Relay production deployment.
 * 
 * These tests verify core functionality is working after deployment.
 * Requires authenticated session - run auth.setup.ts first if needed.
 * 
 * Usage:
 *   # First time / refresh auth (interactive):
 *   SMOKE_TEST_URL=https://vr.chorecraft.net npx playwright test tests/smoke/auth.setup.ts --headed
 *   
 *   # Run smoke tests (uses saved auth):
 *   SMOKE_TEST_URL=https://vr.chorecraft.net npx playwright test tests/smoke/smoke.spec.ts
 */

const BASE_URL = process.env.SMOKE_TEST_URL || 'https://vr.chorecraft.net';

test.describe('Production Smoke Tests', () => {
  
  test.describe('Health & Connectivity', () => {
    test('health endpoint returns ok', async ({ request }) => {
      const response = await request.get(`${BASE_URL}/health`);
      expect(response.ok()).toBeTruthy();
      
      const data = await response.json();
      expect(data.status).toBe('ok');
    });

    test('server info endpoint returns URLs', async ({ request }) => {
      const response = await request.get(`${BASE_URL}/api/server-info`);
      expect(response.ok()).toBeTruthy();
      
      const data = await response.json();
      expect(data.urls).toBeDefined();
      expect(Array.isArray(data.urls)).toBeTruthy();
    });
  });

  test.describe('Authentication Flow', () => {
    test('login page loads', async ({ page }) => {
      await page.goto(`${BASE_URL}/login`);
      
      await expect(page.getByText('Voice Relay')).toBeVisible();
      await expect(page.getByRole('button', { name: /Sign in with GitHub/i })).toBeVisible();
    });

    test('auth/github redirects to GitHub OAuth', async ({ request }) => {
      const response = await request.get(`${BASE_URL}/auth/github`, {
        maxRedirects: 0,
      });
      
      expect(response.status()).toBe(302);
      const location = response.headers()['location'];
      expect(location).toContain('github.com/login/oauth/authorize');
    });
  });

  test.describe('Authenticated Features', () => {
    // These tests use the saved auth state
    test.use({ 
      storageState: 'tests/smoke/.auth-state.json',
    });

    test('dashboard loads when authenticated', async ({ page }) => {
      await page.goto(`${BASE_URL}/dashboard`);
      
      // Should not redirect to login
      await expect(page).not.toHaveURL(/\/login/);
      
      // Dashboard should show workspaces or create workspace option
      await expect(page.getByText(/workspace/i)).toBeVisible({ timeout: 10000 });
    });

    test('can access auth/me endpoint', async ({ request }) => {
      const response = await request.get(`${BASE_URL}/auth/me`);
      expect(response.ok()).toBeTruthy();
      
      const data = await response.json();
      expect(data.user).toBeDefined();
      expect(data.user.username).toBeDefined();
    });

    test('workspaces API returns data', async ({ request }) => {
      const response = await request.get(`${BASE_URL}/api/workspaces`);
      expect(response.ok()).toBeTruthy();
      
      const data = await response.json();
      expect(Array.isArray(data)).toBeTruthy();
    });

    test('WebSocket connection can be established', async ({ page }) => {
      await page.goto(`${BASE_URL}/dashboard`);
      
      // Check WebSocket connection status via page evaluation
      const wsConnected = await page.evaluate(async () => {
        return new Promise((resolve) => {
          const ws = new WebSocket(`wss://${window.location.host}/ws`);
          ws.onopen = () => {
            ws.close();
            resolve(true);
          };
          ws.onerror = () => resolve(false);
          setTimeout(() => resolve(false), 5000);
        });
      });
      
      expect(wsConnected).toBeTruthy();
    });
  });
});
