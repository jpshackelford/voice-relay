import { chromium, type FullConfig } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const AUTH_FILE = path.join(__dirname, '.auth-state.json');

/**
 * Global setup: Authenticate once and save state for smoke tests.
 * 
 * This uses an interactive browser to complete GitHub OAuth.
 * Run with: npx playwright test --project=smoke-setup
 * 
 * After setup completes, auth state is saved to .auth-state.json
 * and reused by subsequent smoke tests.
 */
async function globalSetup(config: FullConfig) {
  const baseURL = process.env.SMOKE_TEST_URL || 'https://vr.chorecraft.net';
  
  // Skip if auth state already exists and is recent (less than 6 hours old)
  if (fs.existsSync(AUTH_FILE)) {
    const stats = fs.statSync(AUTH_FILE);
    const ageHours = (Date.now() - stats.mtimeMs) / (1000 * 60 * 60);
    if (ageHours < 6) {
      console.log(`Using existing auth state (${ageHours.toFixed(1)} hours old)`);
      return;
    }
  }

  console.log('Starting interactive authentication...');
  console.log(`Opening browser to ${baseURL}/login`);
  console.log('Please complete GitHub OAuth in the browser window.');

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(`${baseURL}/login`);

  // Wait for user to complete OAuth and land on dashboard
  // Timeout after 2 minutes
  await page.waitForURL('**/dashboard', { timeout: 120000 });
  
  console.log('Authentication successful! Saving state...');

  // Save auth state (cookies, localStorage)
  await context.storageState({ path: AUTH_FILE });

  await browser.close();
  console.log(`Auth state saved to ${AUTH_FILE}`);
}

export default globalSetup;
