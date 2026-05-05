import { test, expect } from '@playwright/test';

/**
 * E2E tests for Voice Relay
 * 
 * Note: Full relay functionality tests require authenticated users and workspaces.
 * These tests require GitHub OAuth configured. The tests below verify the auth
 * flow UI and landing pages work correctly.
 * 
 * For full relay testing, see server unit tests (97%+ coverage) which test
 * the WebSocket relay, workspace isolation, and message history functionality.
 */

test.describe('Voice Relay Authentication', () => {
  test('root redirects to login when not authenticated', async ({ page }) => {
    await page.goto('/');
    
    // Should redirect to login
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByText('Voice Relay')).toBeVisible();
    await expect(page.getByRole('button', { name: /Sign in with GitHub/i })).toBeVisible();
  });

  test('login page displays correctly', async ({ page }) => {
    await page.goto('/login');
    
    await expect(page.getByText('Voice Relay')).toBeVisible();
    await expect(page.getByText('Real-time voice and text communication')).toBeVisible();
    await expect(page.getByRole('button', { name: /Sign in with GitHub/i })).toBeVisible();
    await expect(page.getByText('GitHub account')).toBeVisible();
  });

  test('login page shows error message when error param present', async ({ page }) => {
    await page.goto('/login?error=1');
    
    await expect(page.getByText('Authentication failed')).toBeVisible();
  });

  test('dashboard redirects to login when not authenticated', async ({ page }) => {
    await page.goto('/dashboard');
    
    // Should redirect to login
    await expect(page).toHaveURL(/\/login/);
  });

  test('workspace page redirects to login when not authenticated', async ({ page }) => {
    await page.goto('/workspace/some-workspace-id');
    
    // Should redirect to login
    await expect(page).toHaveURL(/\/login/);
  });

  test('GitHub login button initiates OAuth flow', async ({ page }) => {
    await page.goto('/login');
    
    // Click GitHub login button
    const [request] = await Promise.all([
      page.waitForRequest(req => req.url().includes('/auth/github')),
      page.getByRole('button', { name: /Sign in with GitHub/i }).click()
    ]);
    
    // Verify the request was made to the auth endpoint
    expect(request.url()).toContain('/auth/github');
  });
});

test.describe('API Health Check', () => {
  test('health endpoint returns ok status', async ({ request }) => {
    const response = await request.get('/health');
    expect(response.ok()).toBeTruthy();
    
    const data = await response.json();
    expect(data.status).toBe('ok');
  });

  test('server info endpoint returns network info', async ({ request }) => {
    const response = await request.get('/api/server-info');
    expect(response.ok()).toBeTruthy();
    
    const data = await response.json();
    expect(data).toHaveProperty('port');
    expect(data).toHaveProperty('urls');
    expect(Array.isArray(data.urls)).toBeTruthy();
  });
});

test.describe('Workspace API without Auth', () => {
  test('workspace list requires authentication', async ({ request }) => {
    const response = await request.get('/api/workspaces');
    expect(response.status()).toBe(401);
  });

  test('workspace creation requires authentication', async ({ request }) => {
    const response = await request.post('/api/workspaces', {
      data: { name: 'Test Workspace' }
    });
    expect(response.status()).toBe(401);
  });

  test('workspace join requires authentication', async ({ request }) => {
    const response = await request.post('/api/workspaces/join', {
      data: { code: 'TEST123' }
    });
    expect(response.status()).toBe(401);
  });
});
