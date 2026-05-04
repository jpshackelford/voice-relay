import { test, expect, Page, BrowserContext } from '@playwright/test';

// Helper to set up a device
async function setupDevice(page: Page, name: string, mode: 'input' | 'output') {
  await page.goto('/');
  await page.getByPlaceholder('e.g., Kitchen iPad').fill(name);
  
  // Click the mode button and wait for it to be selected
  const modeButton = mode === 'input' 
    ? page.getByRole('button', { name: /📤 Input/i })
    : page.getByRole('button', { name: /📥 Output/i });
  
  await modeButton.click();
  await expect(modeButton).toHaveClass(/active/);
  
  // Use exact match to avoid matching "Connect another device"
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  
  // Wait for connection
  await expect(page.getByText('● Connected')).toBeVisible({ timeout: 5000 });
}

test.describe('Voice Relay', () => {
  test('device setup shows input and output mode options', async ({ page }) => {
    await page.goto('/');
    
    await expect(page.getByText('Voice Relay')).toBeVisible();
    await expect(page.getByPlaceholder('e.g., Kitchen iPad')).toBeVisible();
    await expect(page.getByRole('button', { name: /Input/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Output/i })).toBeVisible();
  });

  test('can connect as input device', async ({ page }) => {
    await setupDevice(page, 'Test Input', 'input');
    
    await expect(page.getByText('📤 Test Input')).toBeVisible();
    await expect(page.getByPlaceholder(/Type a message/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /Speak/i })).toBeVisible();
  });

  test('can connect as output device', async ({ page }) => {
    await setupDevice(page, 'Test Output', 'output');
    
    await expect(page.getByText('📥 Test Output')).toBeVisible();
    await expect(page.getByText(/Waiting for messages/i)).toBeVisible();
    await expect(page.getByText('Text-to-Speech')).toBeVisible();
  });

  test('can switch between input and output modes', async ({ page }) => {
    await setupDevice(page, 'Switchable Device', 'input');
    
    await expect(page.getByText('📤 Switchable Device')).toBeVisible();
    
    // Button text is "📥 Output" not "Switch to Output"
    await page.getByRole('button', { name: '📥 Output' }).click();
    
    await expect(page.getByText('📥 Switchable Device')).toBeVisible();
    
    // Button text is "📤 Input" not "Switch to Input"
    await page.getByRole('button', { name: '📤 Input' }).click();
    
    await expect(page.getByText('📤 Switchable Device')).toBeVisible();
  });
});

test.describe('Two Browser Text Relay', () => {
  let inputContext: BrowserContext;
  let outputContext: BrowserContext;
  let inputPage: Page;
  let outputPage: Page;

  test.beforeEach(async ({ browser }) => {
    // Create two separate browser contexts (like two different users)
    inputContext = await browser.newContext();
    outputContext = await browser.newContext();
    
    inputPage = await inputContext.newPage();
    outputPage = await outputContext.newPage();
  });

  test.afterEach(async () => {
    await inputContext.close();
    await outputContext.close();
  });

  test('text typed in input device appears in output device', async () => {
    // Set up both devices
    await setupDevice(outputPage, 'Living Room Display', 'output');
    await setupDevice(inputPage, 'Johns Laptop', 'input');
    
    // Verify they see each other in device list
    await expect(outputPage.getByText('Johns Laptop')).toBeVisible({ timeout: 3000 });
    await expect(inputPage.getByText('Living Room Display')).toBeVisible({ timeout: 3000 });
    
    // Type a message
    const textarea = inputPage.getByPlaceholder(/Type a message/i);
    await textarea.fill('Hello from the input device!');
    
    // Send it (press Enter)
    await textarea.press('Enter');
    
    // Verify it appears on output
    await expect(outputPage.getByText('Hello from the input device!')).toBeVisible({ timeout: 5000 });
    await expect(outputPage.getByText('Johns Laptop:')).toBeVisible();
  });

  test('partial text (typing) appears with visual indicator', async () => {
    await setupDevice(outputPage, 'Output Device', 'output');
    await setupDevice(inputPage, 'Input Device', 'input');
    
    // Type without sending
    const textarea = inputPage.getByPlaceholder(/Type a message/i);
    await textarea.fill('Still typing...');
    
    // Wait for debounced partial to be sent
    await expect(outputPage.getByText('Still typing...')).toBeVisible({ timeout: 2000 });
    
    // Should show typing indicator (the message should have partial styling)
    const message = outputPage.locator('.message.partial');
    await expect(message).toBeVisible();
  });

  test('multiple messages relay correctly', async () => {
    await setupDevice(outputPage, 'Display', 'output');
    await setupDevice(inputPage, 'Sender', 'input');
    
    const textarea = inputPage.getByPlaceholder(/Type a message/i);
    
    // Send multiple messages
    await textarea.fill('First message');
    await textarea.press('Enter');
    
    await textarea.fill('Second message');
    await textarea.press('Enter');
    
    await textarea.fill('Third message');
    await textarea.press('Enter');
    
    // Verify all appear on output in order
    await expect(outputPage.getByText('First message')).toBeVisible({ timeout: 3000 });
    await expect(outputPage.getByText('Second message')).toBeVisible();
    await expect(outputPage.getByText('Third message')).toBeVisible();
  });

  test('output device shows device count', async () => {
    await setupDevice(outputPage, 'Output', 'output');
    
    // Initially no input devices
    await expect(outputPage.getByText('Receiving from 0 devices')).toBeVisible();
    
    // Connect input device
    await setupDevice(inputPage, 'Input', 'input');
    
    // Should now show 1 input device
    await expect(outputPage.getByText('Receiving from 1 device')).toBeVisible({ timeout: 3000 });
  });

  test('input device shows broadcasting count', async () => {
    await setupDevice(inputPage, 'Input', 'input');
    
    // Initially no output devices
    await expect(inputPage.getByText('Broadcasting to 0 devices')).toBeVisible();
    
    // Connect output device
    await setupDevice(outputPage, 'Output', 'output');
    
    // Should now show 1 output device
    await expect(inputPage.getByText('Broadcasting to 1 device')).toBeVisible({ timeout: 3000 });
  });
});

test.describe('Message History', () => {
  let inputContext: BrowserContext;
  let output1Context: BrowserContext;
  let output2Context: BrowserContext;
  let inputPage: Page;
  let output1Page: Page;
  let output2Page: Page;

  test.beforeEach(async ({ browser }) => {
    inputContext = await browser.newContext();
    output1Context = await browser.newContext();
    output2Context = await browser.newContext();
    
    inputPage = await inputContext.newPage();
    output1Page = await output1Context.newPage();
    output2Page = await output2Context.newPage();
  });

  test.afterEach(async () => {
    await inputContext.close();
    await output1Context.close();
    await output2Context.close();
  });

  test('late-joining output device receives message history', async () => {
    // Set up input and first output
    await setupDevice(output1Page, 'First Output', 'output');
    await setupDevice(inputPage, 'Input', 'input');
    
    // Send some messages
    const textarea = inputPage.getByPlaceholder(/Type a message/i);
    await textarea.fill('Message before second output joined');
    await textarea.press('Enter');
    
    // Wait for message to appear on first output
    await expect(output1Page.getByText('Message before second output joined')).toBeVisible({ timeout: 3000 });
    
    // Now connect second output device (late joiner)
    await setupDevice(output2Page, 'Second Output', 'output');
    
    // Second output should also see the message from history
    await expect(output2Page.getByText('Message before second output joined')).toBeVisible({ timeout: 3000 });
  });
});
