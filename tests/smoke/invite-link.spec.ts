import { test, expect, Page, BrowserContext, Browser } from '@playwright/test';
import * as path from 'path';

/**
 * E2E Smoke tests for the workspace invite link flow.
 * 
 * Tests validate that:
 * 1. Workspace owners can see and copy invite links
 * 2. Unauthenticated users are redirected to login
 * 3. Authenticated users can join via invite links
 * 4. Invalid codes show appropriate error messages
 * 5. Non-owners don't see the Settings section
 * 
 * Uses saved auth state from smoke:auth setup.
 */

const BASE_URL = process.env.SMOKE_TEST_URL || 'https://vr.chorecraft.net';
const AUTH_FILE = path.join(__dirname, '.auth-state.json');

// Helper to extract join code from invite link
function extractJoinCode(inviteLink: string): string | null {
  const match = inviteLink.match(/\/join\/([A-Za-z0-9_-]+)/);
  return match ? match[1] : null;
}

test.describe('Invite Link Flow', () => {
  
  test.describe('Owner-Only Features', () => {
    // Use saved auth state for authenticated tests
    test.use({ 
      storageState: AUTH_FILE,
    });

    test('owner sees Settings section with Invite Link option', async ({ page }) => {
      // First get workspaces to find one where user is owner
      const response = await page.request.get(`${BASE_URL}/api/workspaces`);
      expect(response.ok()).toBeTruthy();
      
      const workspaces = await response.json();
      const ownedWorkspace = workspaces.find((ws: { isOwner: boolean }) => ws.isOwner);
      
      if (!ownedWorkspace) {
        test.skip(true, 'No owned workspace found - test user does not own any workspaces');
        return;
      }

      await page.goto(`${BASE_URL}/workspace/${ownedWorkspace.id}`);
      
      // Settings section should be visible for owner
      await expect(
        page.getByRole('heading', { name: /settings/i })
      ).toBeVisible({ timeout: 10000 });
      
      // Invite link button should be present
      await expect(
        page.getByRole('button', { name: /copy invite link/i })
      ).toBeVisible();
    });

    test('owner can copy invite link', async ({ page, context }) => {
      // Grant clipboard permissions
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      
      // Get owned workspace
      const response = await page.request.get(`${BASE_URL}/api/workspaces`);
      expect(response.ok()).toBeTruthy();
      
      const workspaces = await response.json();
      const ownedWorkspace = workspaces.find((ws: { isOwner: boolean }) => ws.isOwner);
      
      if (!ownedWorkspace) {
        test.skip(true, 'No owned workspace found');
        return;
      }

      await page.goto(`${BASE_URL}/workspace/${ownedWorkspace.id}`);
      
      // Wait for page to load
      await expect(
        page.getByRole('button', { name: /copy invite link/i })
      ).toBeVisible({ timeout: 10000 });
      
      // Click the copy button
      await page.getByRole('button', { name: /copy invite link/i }).click();
      
      // Button should show "Copied!" feedback
      await expect(
        page.getByRole('button', { name: /copied/i })
      ).toBeVisible({ timeout: 5000 });
      
      // Read and verify clipboard content - validate complete URL structure
      const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
      expect(clipboardText).toMatch(new RegExp(`^${BASE_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/join/[A-Za-z0-9_-]+$`));
    });

    test('invite link URL format is /join/{code}', async ({ page, context }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      
      const response = await page.request.get(`${BASE_URL}/api/workspaces`);
      expect(response.ok()).toBeTruthy();
      
      const workspaces = await response.json();
      const ownedWorkspace = workspaces.find((ws: { isOwner: boolean, joinCode?: string }) => 
        ws.isOwner && ws.joinCode
      );
      
      if (!ownedWorkspace) {
        test.skip(true, 'No owned workspace with joinCode found');
        return;
      }

      await page.goto(`${BASE_URL}/workspace/${ownedWorkspace.id}`);
      
      await page.getByRole('button', { name: /copy invite link/i }).click();
      
      const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
      
      // Verify the URL structure
      const url = new URL(clipboardText);
      expect(url.pathname).toMatch(/^\/join\/[A-Za-z0-9_-]+$/);
      
      // The join code should match the workspace's joinCode
      const extractedCode = extractJoinCode(clipboardText);
      expect(extractedCode).not.toBeNull();
      expect(extractedCode).toBe(ownedWorkspace.joinCode);
    });
  });

  test.describe('Unauthenticated User Flow', () => {
    
    test('unauthenticated user redirects to login with returnTo', async ({ browser }) => {
      // Create fresh context without auth state
      const context = await browser.newContext();
      const page = await context.newPage();
      
      try {
        // Navigate to a join URL
        await page.goto(`${BASE_URL}/join/TEST-CODE-12345`);
        
        // Should redirect to login with returnTo parameter
        await expect(page).toHaveURL(/\/login\?returnTo=/i, { timeout: 10000 });
        
        // The returnTo should contain the join path
        const currentUrl = page.url();
        expect(currentUrl).toContain(encodeURIComponent('/join/'));
        
        // Login page should be visible
        await expect(
          page.getByRole('button', { name: /sign in with github/i })
        ).toBeVisible();
      } finally {
        await context.close();
      }
    });
  });

  test.describe('Join Workspace Flow', () => {
    test.use({ 
      storageState: AUTH_FILE,
    });

    test('already-member user redirects to workspace', async ({ page }) => {
      // Get user's workspace
      const response = await page.request.get(`${BASE_URL}/api/workspaces`);
      expect(response.ok()).toBeTruthy();
      
      const workspaces = await response.json();
      const memberWorkspace = workspaces.find((ws: { joinCode?: string }) => ws.joinCode);
      
      if (!memberWorkspace) {
        test.skip(true, 'No workspace with joinCode found');
        return;
      }

      await page.goto(`${BASE_URL}/join/${memberWorkspace.joinCode}`);
      
      // Wait for redirect to workspace (success state triggers redirect after ~1s)
      await expect(page).toHaveURL(
        `${BASE_URL}/workspace/${memberWorkspace.id}`,
        { timeout: 10000 }
      );
    });

    test('invalid join code shows error', async ({ page }) => {
      // Use a clearly invalid code
      await page.goto(`${BASE_URL}/join/INVALID-CODE-DOES-NOT-EXIST-12345`);
      
      // Should show error state
      await expect(
        page.getByText(/unable to join/i)
      ).toBeVisible({ timeout: 10000 });
      
      await expect(
        page.getByText(/invalid or has expired/i)
      ).toBeVisible();
      
      // Should have navigation options
      await expect(
        page.getByRole('button', { name: /go to dashboard/i })
      ).toBeVisible();
    });
  });

  test.describe('Non-Owner Access Control', () => {
    test.use({ 
      storageState: AUTH_FILE,
    });

    test('non-owner does not see Settings section', async ({ page }) => {
      // Find a workspace where user is NOT the owner
      const response = await page.request.get(`${BASE_URL}/api/workspaces`);
      expect(response.ok()).toBeTruthy();
      
      const workspaces = await response.json();
      const nonOwnedWorkspace = workspaces.find((ws: { isOwner: boolean }) => !ws.isOwner);
      
      if (!nonOwnedWorkspace) {
        // If user owns all workspaces, we can't test this scenario
        test.skip(true, 'User owns all workspaces - cannot test non-owner view');
        return;
      }

      await page.goto(`${BASE_URL}/workspace/${nonOwnedWorkspace.id}`);
      
      // Wait for page content to load
      await expect(
        page.getByRole('heading', { name: /devices/i })
      ).toBeVisible({ timeout: 10000 });
      
      // Settings section should NOT be visible for non-owner
      await expect(
        page.getByRole('heading', { name: /settings/i })
      ).not.toBeVisible();
      
      // Invite link button should NOT be visible
      await expect(
        page.getByRole('button', { name: /copy invite link/i })
      ).not.toBeVisible();
    });
  });
});
