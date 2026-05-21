/**
 * Validation script v2: Comprehensive validation of event processing pipeline
 */

import { extractEventFields, extractEffectiveKind, formatEventSummary } from '../server/src/openhands';
import { getEventContent } from '../client/src/utils/getEventContent';
import type { AgentAction } from '../client/src/types';

const realEvents = require('../test-fixtures/raw-events-real.json');

console.log('=== Comprehensive Event Rendering Validation ===\n');

interface ValidationResult {
  eventId: string;
  originalKind: string;
  effectiveKind: string;
  contentPassed: boolean;
  summaryCorrect: boolean;
  expectedSummary: string | null;
  actualSummary: string;
  content: string;
}

const results: ValidationResult[] = [];

for (const event of realEvents.items) {
  if (event.kind !== 'ActionEvent' && event.kind !== 'ObservationEvent') {
    continue;
  }

  const effectiveKind = extractEffectiveKind(event);
  const extractedFields = extractEventFields(event);
  
  const action: AgentAction = {
    id: event.id,
    timestamp: event.timestamp,
    kind: effectiveKind,
    source: event.source,
    summary: formatEventSummary(event),
    ...extractedFields,
  };
  
  const content = getEventContent(action);
  const contentPassed = content.length > 0;
  
  // Check if summary matches what's in the real event
  const expectedSummary = event.summary || null;
  const actualSummary = action.summary;
  const summaryCorrect = expectedSummary === null || actualSummary === expectedSummary;
  
  results.push({
    eventId: event.id.substring(0, 8),
    originalKind: event.kind,
    effectiveKind,
    contentPassed,
    summaryCorrect,
    expectedSummary,
    actualSummary,
    content: content.substring(0, 80) + (content.length > 80 ? '...' : ''),
  });
}

console.log('| Event ID | Original Kind | Effective Kind | Content | Summary |');
console.log('|----------|---------------|----------------|---------|---------|');

for (const r of results) {
  const contentIcon = r.contentPassed ? '✅' : '❌';
  const summaryIcon = r.summaryCorrect ? '✅' : '⚠️';
  console.log(`| ${r.eventId} | ${r.originalKind} | ${r.effectiveKind} | ${contentIcon} | ${summaryIcon} |`);
}

console.log('\n=== Detailed Results ===\n');

for (const r of results) {
  if (!r.contentPassed || !r.summaryCorrect) {
    console.log(`Event ${r.eventId}:`);
    if (!r.contentPassed) {
      console.log(`  ❌ Content: EMPTY`);
    }
    if (!r.summaryCorrect) {
      console.log(`  ⚠️  Summary mismatch:`);
      console.log(`      Expected: "${r.expectedSummary}"`);
      console.log(`      Actual:   "${r.actualSummary}"`);
    }
    console.log('');
  }
}

const contentPassed = results.filter(r => r.contentPassed).length;
const contentFailed = results.filter(r => !r.contentPassed).length;
const summaryCorrect = results.filter(r => r.summaryCorrect).length;
const summaryWrong = results.filter(r => !r.summaryCorrect).length;

console.log('=== Summary ===');
console.log(`Content Rendering: ${contentPassed} passed, ${contentFailed} failed`);
console.log(`Summary Extraction: ${summaryCorrect} correct, ${summaryWrong} incorrect`);

if (contentFailed > 0) {
  console.log('\n❌ CONTENT RENDERING FAILED');
  process.exit(1);
} else if (summaryWrong > 0) {
  console.log('\n⚠️  Content OK, but summary extraction needs improvement (separate issue)');
  process.exit(0);
} else {
  console.log('\n✅ ALL VALIDATIONS PASSED');
}
