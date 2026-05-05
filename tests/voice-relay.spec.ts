import { test, expect, Page, BrowserContext } from '@playwright/test';

// In E2E mode, the app uses a mock workspace at /workspace/test
// The client bypasses authentication and returns a mock workspace
const WORKSPACE_URL = '/workspace/test';

// Helper to set up a device with the new mobile/kiosk modes
async function setupDevice(page: Page, name: string, mode: 'mobile' | 'kiosk') {
  await page.goto(WORKSPACE_URL);
  
  // Wait for workspace to load (should show device setup form)
  await expect(page.getByPlaceholder('e.g., Kitchen iPad')).toBeVisible({ timeout: 10000 });
  
  await page.getByPlaceholder('e.g., Kitchen iPad').fill(name);
  
  // Click the mode button and wait for it to be selected
  const modeButton = mode === 'mobile' 
    ? page.getByRole('button', { name: /📱 Mobile/i })
    : page.getByRole('button', { name: /🖥️ Kiosk/i });
  
  await modeButton.click();
  await expect(modeButton).toHaveClass(/active/);
  
  // Use exact match to avoid matching "Connect another device"
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  
  // Wait for connection
  await expect(page.getByText('● Connected')).toBeVisible({ timeout: 5000 });
}

test.describe('Voice Relay', () => {
  test('device setup shows mobile and kiosk mode options', async ({ page }) => {
    await page.goto(WORKSPACE_URL);
    
    // Wait for workspace to load
    await expect(page.getByText('Voice Relay')).toBeVisible({ timeout: 10000 });
    await expect(page.getByPlaceholder('e.g., Kitchen iPad')).toBeVisible();
    await expect(page.getByRole('button', { name: /Mobile/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Kiosk/i })).toBeVisible();
  });

  test('can connect as mobile device', async ({ page }) => {
    await setupDevice(page, 'Test Mobile', 'mobile');
    
    await expect(page.getByText('📱 Test Mobile')).toBeVisible();
    // Mobile mode has input field and can send/receive
    await expect(page.locator('input[type="text"]')).toBeVisible();
  });

  test('can connect as kiosk device', async ({ page }) => {
    await setupDevice(page, 'Test Kiosk', 'kiosk');
    
    await expect(page.getByText('🖥️ Test Kiosk')).toBeVisible();
    // Kiosk has input area and display area
    await expect(page.locator('input[type="text"]')).toBeVisible();
  });

  test('can switch from mobile to kiosk mode', async ({ page }) => {
    await setupDevice(page, 'Switchable Device', 'mobile');
    
    await expect(page.getByText('📱 Switchable Device')).toBeVisible();
    
    // Switch to kiosk mode
    await page.getByRole('button', { name: /🖥️ Kiosk/i }).click();
    
    await expect(page.getByText('🖥️ Switchable Device')).toBeVisible();
  });
});

test.describe('Two Browser Text Relay', () => {
  let device1Context: BrowserContext;
  let device2Context: BrowserContext;
  let device1Page: Page;
  let device2Page: Page;

  test.beforeEach(async ({ browser }) => {
    // Create two separate browser contexts (like two different users)
    device1Context = await browser.newContext();
    device2Context = await browser.newContext();
    
    device1Page = await device1Context.newPage();
    device2Page = await device2Context.newPage();
  });

  test.afterEach(async () => {
    await device1Context.close();
    await device2Context.close();
  });

  test('text typed on one mobile device appears on another', async () => {
    // Set up both devices as mobile
    await setupDevice(device1Page, 'Living Room Phone', 'mobile');
    await setupDevice(device2Page, 'Kitchen Phone', 'mobile');
    
    // Type a message on device 1
    const input = device1Page.locator('input[type="text"]');
    await input.fill('Hello from device 1!');
    await input.press('Enter');
    
    // Verify it appears on device 2
    await expect(device2Page.getByText('Hello from device 1!')).toBeVisible({ timeout: 5000 });
  });

  test('messages relay between mobile and kiosk', async () => {
    // Set up one mobile and one kiosk
    await setupDevice(device1Page, 'Wall Display', 'kiosk');
    await setupDevice(device2Page, 'Mobile Phone', 'mobile');
    
    // Send from mobile
    const mobileInput = device2Page.locator('input[type="text"]');
    await mobileInput.fill('Message from mobile');
    await mobileInput.press('Enter');
    
    // Verify it appears on kiosk
    await expect(device1Page.getByText('Message from mobile')).toBeVisible({ timeout: 5000 });
    
    // Send from kiosk
    const kioskInput = device1Page.locator('input[type="text"]');
    await kioskInput.fill('Reply from kiosk');
    await kioskInput.press('Enter');
    
    // Verify it appears on mobile
    await expect(device2Page.getByText('Reply from kiosk')).toBeVisible({ timeout: 5000 });
  });

  test('multiple messages relay correctly', async () => {
    await setupDevice(device1Page, 'Sender', 'mobile');
    await setupDevice(device2Page, 'Receiver', 'mobile');
    
    const input = device1Page.locator('input[type="text"]');
    
    // Send multiple messages
    await input.fill('First message');
    await input.press('Enter');
    
    await input.fill('Second message');
    await input.press('Enter');
    
    await input.fill('Third message');
    await input.press('Enter');
    
    // Verify all appear on the other device
    await expect(device2Page.getByText('First message')).toBeVisible({ timeout: 3000 });
    await expect(device2Page.getByText('Second message')).toBeVisible();
    await expect(device2Page.getByText('Third message')).toBeVisible();
  });
});

test.describe('Message History', () => {
  let device1Context: BrowserContext;
  let device2Context: BrowserContext;
  let device3Context: BrowserContext;
  let device1Page: Page;
  let device2Page: Page;
  let device3Page: Page;

  test.beforeEach(async ({ browser }) => {
    device1Context = await browser.newContext();
    device2Context = await browser.newContext();
    device3Context = await browser.newContext();
    
    device1Page = await device1Context.newPage();
    device2Page = await device2Context.newPage();
    device3Page = await device3Context.newPage();
  });

  test.afterEach(async () => {
    await device1Context.close();
    await device2Context.close();
    await device3Context.close();
  });

  test('late-joining device receives message history', async () => {
    // Set up first two devices
    await setupDevice(device1Page, 'First Device', 'mobile');
    await setupDevice(device2Page, 'Second Device', 'mobile');
    
    // Send some messages
    const input = device1Page.locator('input[type="text"]');
    await input.fill('Message before third device joined');
    await input.press('Enter');
    
    // Wait for message to appear on second device
    await expect(device2Page.getByText('Message before third device joined').first()).toBeVisible({ timeout: 3000 });
    
    // Now connect third device (late joiner)
    await setupDevice(device3Page, 'Third Device', 'mobile');
    
    // Third device should also see the message from history
    await expect(device3Page.getByText('Message before third device joined').first()).toBeVisible({ timeout: 3000 });
  });
});
