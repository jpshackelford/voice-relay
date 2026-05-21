/**
 * Validation script: Feed real captured events through the processing pipeline
 * and verify the output matches expectations.
 * 
 * This validates end-to-end that:
 * 1. Server extracts fields correctly from real event structures
 * 2. Client renders content correctly for those events
 */

import { extractEventFields, extractEffectiveKind, formatEventSummary } from '../server/src/openhands';
import { getEventContent } from '../client/src/utils/getEventContent';
import type { AgentAction } from '../client/src/types';

// Load real captured events
const realEvents = require('../test-fixtures/raw-events-real.json');

console.log('=== Event Rendering Validation ===\n');
console.log(`Loaded ${realEvents.items.length} real events from test fixtures\n`);

let passed = 0;
let failed = 0;

for (const event of realEvents.items) {
  if (event.kind !== 'ActionEvent' && event.kind !== 'ObservationEvent') {
    continue; // Skip non-action/observation events
  }

  console.log(`--- Event: ${event.id} ---`);
  console.log(`  Original kind: ${event.kind}`);
  console.log(`  Tool name: ${event.tool_name}`);
  
  // Step 1: Extract effective kind (what client will use for dispatch)
  const effectiveKind = extractEffectiveKind(event);
  console.log(`  Effective kind: ${effectiveKind}`);
  
  // Step 2: Extract fields
  const extractedFields = extractEventFields(event);
  console.log(`  Extracted fields:`, JSON.stringify(extractedFields, null, 4));
  
  // Step 3: Build AgentAction as server would
  const action: AgentAction = {
    id: event.id,
    timestamp: event.timestamp,
    kind: effectiveKind, // Use effective kind!
    source: event.source,
    summary: formatEventSummary(event),
    ...extractedFields,
  };
  
  console.log(`  Summary: "${action.summary}"`);
  
  // Step 4: Get rendered content as client would
  const content = getEventContent(action);
  
  console.log(`  Rendered content:`);
  if (content) {
    console.log(`    ${content.replace(/\n/g, '\n    ')}`);
    passed++;
  } else {
    console.log(`    [EMPTY - VALIDATION FAILED]`);
    failed++;
  }
  
  // Validation checks
  const isTerminal = event.tool_name === 'terminal';
  if (isTerminal) {
    const hasCommand = content.includes('Command:') || content.includes('command');
    if (!hasCommand && event.kind === 'ActionEvent') {
      console.log(`  ⚠️  WARNING: Terminal action missing command in rendered content`);
    }
    
    if (event.kind === 'ObservationEvent') {
      const hasOutput = content.includes('Output:') || content.includes('```');
      if (!hasOutput) {
        console.log(`  ⚠️  WARNING: Terminal observation missing output in rendered content`);
      }
    }
  }
  
  console.log('');
}

console.log('=== Summary ===');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Total action/observation events: ${passed + failed}`);

if (failed > 0) {
  console.log('\n❌ VALIDATION FAILED - Some events did not render content');
  process.exit(1);
} else {
  console.log('\n✅ VALIDATION PASSED - All events rendered content successfully');
}
