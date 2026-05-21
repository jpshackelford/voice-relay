/**
 * Capture real events from OpenHands WebSocket API for test fixture generation.
 * 
 * Usage: npx tsx scripts/capture-events.ts <conversation_id>
 * 
 * This connects to OpenHands, captures events, and saves them to test-fixtures/
 */

import WebSocket from 'ws';

const OPENHANDS_URL = process.env.OPENHANDS_URL || 'wss://app.all-hands.dev';
const API_KEY = process.env.OPENHANDS_API_KEY || process.env.OH_API_KEY;

if (!API_KEY) {
  console.error('Error: OPENHANDS_API_KEY or OH_API_KEY environment variable required');
  process.exit(1);
}

const conversationId = process.argv[2];
if (!conversationId) {
  console.error('Usage: npx tsx scripts/capture-events.ts <conversation_id>');
  process.exit(1);
}

const events: unknown[] = [];

const wsUrl = `${OPENHANDS_URL}/ws/v1/conversation/${conversationId}/events?token=${API_KEY}`;
console.log(`Connecting to: ${OPENHANDS_URL}/ws/v1/conversation/${conversationId}/events`);

const ws = new WebSocket(wsUrl);

ws.on('open', () => {
  console.log('Connected. Capturing events... (Ctrl+C to stop and save)');
});

ws.on('message', (data: Buffer) => {
  try {
    const event = JSON.parse(data.toString());
    events.push(event);
    console.log(`Captured event #${events.length}: kind=${event.kind || 'unknown'}`);
  } catch (e) {
    console.error('Failed to parse event:', e);
  }
});

ws.on('error', (err: Error) => {
  console.error('WebSocket error:', err.message);
});

ws.on('close', (code: number) => {
  console.log(`Connection closed: ${code}`);
  saveEvents();
});

process.on('SIGINT', () => {
  console.log('\nStopping capture...');
  ws.close();
});

function saveEvents() {
  if (events.length === 0) {
    console.log('No events captured.');
    return;
  }

  const filename = `test-fixtures/raw-events-${Date.now()}.json`;
  require('fs').writeFileSync(filename, JSON.stringify(events, null, 2));
  console.log(`\nSaved ${events.length} events to ${filename}`);
  
  // Also print summary of event kinds
  const kindCounts: Record<string, number> = {};
  events.forEach((e: any) => {
    const kind = e.kind || 'unknown';
    kindCounts[kind] = (kindCounts[kind] || 0) + 1;
  });
  console.log('\nEvent kinds captured:');
  Object.entries(kindCounts).forEach(([kind, count]) => {
    console.log(`  ${kind}: ${count}`);
  });
}
