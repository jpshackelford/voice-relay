import { test, expect } from '@playwright/test';
import * as path from 'path';

/**
 * Smoke tests for Voice Relay production deployment.
 * 
 * These tests verify core functionality is working after deployment.
 * 
 * Authentication options:
 * 1. Automated (CI): Set TEST_AUTH_SECRET env var - uses /auth/test-session endpoint
 * 2. Interactive: Run smoke:auth first to save session state
 * 
 * Usage:
 *   # Automated (requires TEST_AUTH_SECRET on server and in env):
 *   TEST_AUTH_SECRET=xxx SMOKE_TEST_URL=https://vr.chorecraft.net npm run smoke
 *   
 *   # Interactive (manual OAuth):
 *   SMOKE_TEST_URL=https://vr.chorecraft.net npm run smoke:auth
 *   SMOKE_TEST_URL=https://vr.chorecraft.net npm run smoke
 * 
 * Note: Auth state is created by global-setup.ts before tests run.
 */

const BASE_URL = process.env.SMOKE_TEST_URL || 'https://vr.chorecraft.net';
const AUTH_FILE = path.join(__dirname, '.auth-state.json');

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
    // Use the saved auth state (created by beforeAll in parent scope)
    test.use({ 
      storageState: AUTH_FILE,
    });

    test('dashboard loads when authenticated', async ({ page }) => {
      await page.goto(`${BASE_URL}/dashboard`);
      
      // Should not redirect to login
      await expect(page).not.toHaveURL(/\/login/);
      
      // Dashboard redirects to workspace home which shows devices and sessions sections
      // Check for either heading to confirm workspace home loaded
      await expect(
        page.getByRole('heading', { name: /devices/i }).or(page.getByRole('heading', { name: /sessions/i }))
      ).toBeVisible({ timeout: 10000 });
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
