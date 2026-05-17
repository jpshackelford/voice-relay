import { chromium, request } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const AUTH_FILE = path.join(__dirname, '.auth-state.json');

/**
 * Global setup: Authenticate and save state for smoke tests.
 * 
 * Authentication methods:
 * 1. If TEST_AUTH_SECRET is set: Uses /auth/test-session endpoint (automated)
 * 2. Otherwise: Opens interactive browser for GitHub OAuth (manual)
 * 
 * After setup completes, auth state is saved to .auth-state.json
 * and reused by subsequent smoke tests.
 */
async function globalSetup() {
  const baseURL = process.env.SMOKE_TEST_URL || 'https://app.no-hands.dev';
  const testAuthSecret = process.env.TEST_AUTH_SECRET;
  
  // Option 1: Automated authentication using test endpoint
  if (testAuthSecret) {
    console.log('Using TEST_AUTH_SECRET for automated authentication...');
    
    const context = await request.newContext();
    const response = await context.post(`${baseURL}/auth/test-session`, {
      headers: {
        'X-Test-Auth-Secret': testAuthSecret,
      },
    });
    
    if (!response.ok()) {
      const body = await response.text();
      throw new Error(`Test auth failed: ${response.status()} ${body}\nIs TEST_AUTH_SECRET set correctly on the server?`);
    }
    
    // Parse cookies from response
    const cookies = await response.headersArray();
    const setCookies = cookies.filter(h => h.name.toLowerCase() === 'set-cookie');
    
    const cookieObjects = setCookies.map(h => {
      const cookiePart = h.value.split(';')[0];
      const eqIndex = cookiePart.indexOf('=');
      // Parse Max-Age from cookie header if present
      const maxAgeMatch = h.value.match(/Max-Age=(\d+)/i);
      const maxAge = maxAgeMatch ? parseInt(maxAgeMatch[1], 10) : 86400; // Default 1 day
      return {
        name: cookiePart.substring(0, eqIndex),
        value: cookiePart.substring(eqIndex + 1),
        domain: new URL(baseURL).hostname,
        path: '/',
        httpOnly: true,
        secure: baseURL.startsWith('https'),
        sameSite: 'Lax' as const,
        expires: Math.floor(Date.now() / 1000) + maxAge,
      };
    });
    
    fs.writeFileSync(AUTH_FILE, JSON.stringify({
      cookies: cookieObjects,
      origins: [],
    }));
    
    await context.dispose();
    console.log(`Auth state saved to ${AUTH_FILE}`);
    return;
  }
  
  // Option 2: Check for existing valid auth state
  if (fs.existsSync(AUTH_FILE)) {
    const stats = fs.statSync(AUTH_FILE);
    const ageHours = (Date.now() - stats.mtimeMs) / (1000 * 60 * 60);
    if (ageHours < 6) {
      console.log(`Using existing auth state (${ageHours.toFixed(1)} hours old)`);
      return;
    }
    console.log(`Auth state is ${ageHours.toFixed(1)} hours old, needs refresh`);
  }

  // Option 3: Interactive authentication (for local development)
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
