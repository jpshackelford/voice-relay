/**
 * Comprehensive validation of event rendering against real captured events.
 * 
 * Tests:
 * 1. All event types render content (not empty)
 * 2. Summary extraction works correctly
 * 3. Specific content assertions per event type
 * 4. No runtime errors during processing
 */

import { extractEventFields, extractEffectiveKind, formatEventSummary } from '../server/src/openhands';
import { getEventContent } from '../client/src/utils/getEventContent';
import type { AgentAction } from '../client/src/types';

const diverseEvents = require('../test-fixtures/clean-fixtures.json');

interface TestResult {
  eventId: string;
  toolName: string;
  innerKind: string;
  passed: boolean;
  contentLength: number;
  summaryCorrect: boolean;
  errors: string[];
}

const results: TestResult[] = [];

console.log('=== Comprehensive Event Validation ===\n');
console.log(`Testing ${diverseEvents.events.length} diverse events\n`);

for (const event of diverseEvents.events) {
  const errors: string[] = [];
  const toolName = event.tool_name || 'unknown';
  const innerKind = event.action?.kind || event.observation?.kind || 'unknown';
  
  let effectiveKind: string;
  let extractedFields: Record<string, unknown>;
  let summary: string;
  let content: string;
  
  try {
    // Step 1: Extract effective kind
    effectiveKind = extractEffectiveKind(event);
    if (!effectiveKind || effectiveKind === event.kind) {
      errors.push(`effectiveKind not extracted (got "${effectiveKind}")`);
    }
  } catch (e: any) {
    errors.push(`extractEffectiveKind error: ${e.message}`);
    effectiveKind = event.kind;
  }
  
  try {
    // Step 2: Extract fields
    extractedFields = extractEventFields(event);
  } catch (e: any) {
    errors.push(`extractEventFields error: ${e.message}`);
    extractedFields = {};
  }
  
  try {
    // Step 3: Format summary
    summary = formatEventSummary(event);
    
    // Check if we're using the real summary when available
    if (event.summary && summary !== event.summary) {
      errors.push(`Summary mismatch: expected "${event.summary?.substring(0, 40)}...", got "${summary}"`);
    }
  } catch (e: any) {
    errors.push(`formatEventSummary error: ${e.message}`);
    summary = 'Error';
  }
  
  try {
    // Step 4: Build action and get content
    const action: AgentAction = {
      id: event.id,
      timestamp: event.timestamp,
      kind: effectiveKind,
      source: event.source,
      summary,
      ...extractedFields,
    };
    
    content = getEventContent(action);
    
    // Type-specific validations
    if (innerKind === 'TerminalAction' || innerKind === 'TerminalObservation') {
      if (!content.includes('Command') && !content.includes('Output')) {
        errors.push('Terminal event missing Command/Output in content');
      }
    }
    
    if (innerKind === 'FileEditorAction' || innerKind === 'FileEditorObservation') {
      // File events should have path or content
      if (!content && !extractedFields.path) {
        errors.push('File event missing path/content');
      }
    }
    
    if (innerKind === 'ThinkAction') {
      if (!content && !extractedFields.thought) {
        errors.push('Think action missing thought content');
      }
    }
    
  } catch (e: any) {
    errors.push(`getEventContent error: ${e.message}`);
    content = '';
  }
  
  // Empty content is a failure for most types
  if (content.length === 0 && !['InvokeSkillAction'].includes(innerKind)) {
    errors.push('Content is empty');
  }
  
  const summaryCorrect = !event.summary || summary === event.summary;
  const passed = errors.length === 0;
  
  results.push({
    eventId: event.id.substring(0, 8),
    toolName,
    innerKind,
    passed,
    contentLength: content.length,
    summaryCorrect,
    errors,
  });
}

// Summary by tool/kind
console.log('=== Results by Event Type ===\n');
console.log('| Tool | Kind | Passed | Failed | Content Avg | Summary OK |');
console.log('|------|------|--------|--------|-------------|------------|');

const byType = new Map<string, TestResult[]>();
for (const r of results) {
  const key = `${r.toolName}:${r.innerKind}`;
  if (!byType.has(key)) byType.set(key, []);
  byType.get(key)!.push(r);
}

for (const [key, typeResults] of byType) {
  const [tool, kind] = key.split(':');
  const passed = typeResults.filter(r => r.passed).length;
  const failed = typeResults.filter(r => !r.passed).length;
  const avgContent = Math.round(typeResults.reduce((a, r) => a + r.contentLength, 0) / typeResults.length);
  const summaryOk = typeResults.filter(r => r.summaryCorrect).length;
  
  const passIcon = failed === 0 ? '✅' : '❌';
  const summaryIcon = summaryOk === typeResults.length ? '✅' : '⚠️';
  
  console.log(`| ${tool} | ${kind} | ${passIcon} ${passed} | ${failed} | ${avgContent} chars | ${summaryIcon} ${summaryOk}/${typeResults.length} |`);
}

// Show errors
const failures = results.filter(r => !r.passed);
if (failures.length > 0) {
  console.log('\n=== Failures ===\n');
  for (const f of failures) {
    console.log(`${f.eventId} (${f.toolName}/${f.innerKind}):`);
    for (const err of f.errors) {
      console.log(`  ❌ ${err}`);
    }
  }
}

// Final summary
const totalPassed = results.filter(r => r.passed).length;
const totalFailed = results.filter(r => !r.passed).length;
const summaryIssues = results.filter(r => !r.summaryCorrect).length;

console.log('\n=== Final Summary ===\n');
console.log(`Total Events: ${results.length}`);
console.log(`Passed: ${totalPassed}`);
console.log(`Failed: ${totalFailed}`);
console.log(`Summary Issues: ${summaryIssues}`);

if (totalFailed > 0) {
  console.log('\n❌ VALIDATION FAILED');
  process.exit(1);
} else if (summaryIssues > 0) {
  console.log('\n⚠️  CONTENT OK, SUMMARY NEEDS FIX');
  process.exit(0);
} else {
  console.log('\n✅ ALL VALIDATIONS PASSED');
  process.exit(0);
}
