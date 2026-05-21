/**
 * Capture diverse events from multiple conversations for comprehensive testing.
 * Groups events by tool_name and action/observation kind.
 */

const API_KEY = process.env.OH_API_KEY || process.env.OPENHANDS_API_KEY;
const BASE_URL = 'https://app.all-hands.dev/api/v1';

interface EventSummary {
  tool_name: string | null;
  outer_kind: string;
  inner_kind: string | null;
  count: number;
  example_id: string;
}

async function fetchEvents(conversationId: string, limit = 100): Promise<any[]> {
  const url = `${BASE_URL}/conversation/${conversationId}/events/search?limit=${limit}`;
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Accept': 'application/json',
    },
  });
  const data = await response.json();
  return data.items || [];
}

async function fetchRecentConversations(limit = 20): Promise<string[]> {
  const url = `${BASE_URL}/app-conversations/search?limit=${limit}`;
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Accept': 'application/json',
    },
  });
  const data = await response.json();
  return (data.items || []).map((c: any) => c.id);
}

async function main() {
  console.log('=== Capturing Diverse Events ===\n');
  
  const conversationIds = await fetchRecentConversations(15);
  console.log(`Found ${conversationIds.length} recent conversations\n`);
  
  const allEvents: any[] = [];
  const eventsByType = new Map<string, any[]>();
  
  for (const convId of conversationIds) {
    const events = await fetchEvents(convId, 50);
    console.log(`  ${convId}: ${events.length} events`);
    
    for (const event of events) {
      if (event.kind === 'ActionEvent' || event.kind === 'ObservationEvent') {
        allEvents.push(event);
        
        const toolName = event.tool_name || 'unknown';
        const innerKind = event.action?.kind || event.observation?.kind || 'unknown';
        const key = `${toolName}:${innerKind}`;
        
        if (!eventsByType.has(key)) {
          eventsByType.set(key, []);
        }
        eventsByType.get(key)!.push(event);
      }
    }
  }
  
  console.log(`\n=== Event Type Coverage ===\n`);
  console.log(`Total action/observation events: ${allEvents.length}\n`);
  
  console.log('| Tool | Inner Kind | Count | Example Fields |');
  console.log('|------|------------|-------|----------------|');
  
  const summaries: EventSummary[] = [];
  for (const [key, events] of eventsByType.entries()) {
    const [toolName, innerKind] = key.split(':');
    const example = events[0];
    const exampleFields = Object.keys(example.action || example.observation || {}).slice(0, 5).join(', ');
    
    console.log(`| ${toolName} | ${innerKind} | ${events.length} | ${exampleFields} |`);
    summaries.push({
      tool_name: toolName,
      outer_kind: example.kind,
      inner_kind: innerKind,
      count: events.length,
      example_id: example.id,
    });
  }
  
  // Save diverse events for testing
  const fs = require('fs');
  
  // Pick one example of each type for test fixtures
  const diverseFixtures: any[] = [];
  for (const [key, events] of eventsByType.entries()) {
    // Take up to 2 examples of each type
    diverseFixtures.push(...events.slice(0, 2));
  }
  
  const fixtureData = {
    description: 'Diverse events captured from multiple conversations',
    captured_at: new Date().toISOString(),
    summary: summaries,
    events: diverseFixtures,
  };
  
  fs.writeFileSync(
    'test-fixtures/diverse-events.json',
    JSON.stringify(fixtureData, null, 2)
  );
  
  console.log(`\n✅ Saved ${diverseFixtures.length} diverse events to test-fixtures/diverse-events.json`);
  
  // Also save the raw complete set
  fs.writeFileSync(
    'test-fixtures/all-captured-events.json',
    JSON.stringify({ events: allEvents }, null, 2)
  );
  console.log(`✅ Saved ${allEvents.length} total events to test-fixtures/all-captured-events.json`);
}

main().catch(console.error);
