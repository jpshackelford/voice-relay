import { test, expect } from '@playwright/test';
import * as fs from 'fs';
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
 */

const BASE_URL = process.env.SMOKE_TEST_URL || 'https://vr.chorecraft.net';
const TEST_AUTH_SECRET = process.env.TEST_AUTH_SECRET;
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
    // Authenticate before running these tests
    test.beforeAll(async ({ request }) => {
      // Option 1: Use test auth endpoint (for CI)
      if (TEST_AUTH_SECRET) {
        console.log('Using TEST_AUTH_SECRET for automated authentication');
        const response = await request.post(`${BASE_URL}/auth/test-session`, {
          headers: {
            'X-Test-Auth-Secret': TEST_AUTH_SECRET,
          },
        });
        
        if (!response.ok()) {
          throw new Error(`Test auth failed: ${response.status()} - Is TEST_AUTH_SECRET set on the server?`);
        }
        
        // Save the cookies to auth state file for subsequent tests
        const cookies = await response.headersArray();
        const setCookies = cookies.filter(h => h.name.toLowerCase() === 'set-cookie');
        
        // Create a minimal storage state with the cookies
        const cookieObjects = setCookies.map(h => {
          const parts = h.value.split(';')[0].split('=');
          return {
            name: parts[0],
            value: parts.slice(1).join('='),
            domain: new URL(BASE_URL).hostname,
            path: '/',
            httpOnly: true,
            secure: BASE_URL.startsWith('https'),
            sameSite: 'Lax' as const,
          };
        });
        
        fs.writeFileSync(AUTH_FILE, JSON.stringify({
          cookies: cookieObjects,
          origins: [],
        }));
        
        console.log('Auth state saved from test-session endpoint');
        return;
      }
      
      // Option 2: Use existing auth state file (from interactive login)
      if (fs.existsSync(AUTH_FILE)) {
        console.log('Using existing auth state file');
        return;
      }
      
      throw new Error(
        'No authentication available. Either:\n' +
        '1. Set TEST_AUTH_SECRET env var (must also be set on server), or\n' +
        '2. Run "npm run smoke:auth" first to authenticate interactively'
      );
    });

    // Use the saved auth state
    test.use({ 
      storageState: AUTH_FILE,
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
