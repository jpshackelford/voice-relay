import { test, expect } from '@playwright/test';
import * as path from 'path';

/**
 * API Validation tests for backend endpoints.
 * 
 * These tests validate API request/response handling, error conditions,
 * and parameter validation. They test the API directly without UI interaction.
 * 
 * Prerequisites:
 * - TEST_AUTH_SECRET env var set for automated auth
 * 
 * Usage:
 *   TEST_AUTH_SECRET=xxx SMOKE_TEST_URL=https://vr.chorecraft.net npm run smoke
 */

const BASE_URL = process.env.SMOKE_TEST_URL || 'https://vr.chorecraft.net';
const AUTH_FILE = path.join(__dirname, '.auth-state.json');

test.describe('API Validation', () => {
  
  test.describe('Display API', () => {
    test.use({ storageState: AUTH_FILE });

    test('display API requires type', async ({ request }) => {
      const response = await request.post(`${BASE_URL}/api/display`, {
        data: {
          content: 'test content',
          workspaceId: 'test-workspace'
        }
      });
      
      expect(response.status()).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('type');
    });

    test('display API requires content for non-clear types', async ({ request }) => {
      const response = await request.post(`${BASE_URL}/api/display`, {
        data: {
          type: 'markdown',
          workspaceId: 'test-workspace'
        }
      });
      
      expect(response.status()).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Content');
    });

    test('display API requires workspaceId', async ({ request }) => {
      const response = await request.post(`${BASE_URL}/api/display`, {
        data: {
          type: 'markdown',
          content: '# Test'
        }
      });
      
      expect(response.status()).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('workspaceId');
    });

    test('clear display type does not require content', async ({ request }) => {
      const response = await request.post(`${BASE_URL}/api/display`, {
        data: {
          type: 'clear',
          workspaceId: 'test-workspace'
        }
      });
      
      // Should succeed even without content
      expect(response.ok()).toBeTruthy();
      const data = await response.json();
      expect(data.success).toBe(true);
    });
  });
});
