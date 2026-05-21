/**
 * Create clean test fixtures with minimal, representative events.
 * Uses sanitized data only - no real secrets or large content.
 */

const fs = require('fs');

// Clean fixtures based on real structure but with synthetic data
const cleanFixtures = {
  description: "Clean test fixtures with representative event structures",
  created_at: new Date().toISOString(),
  event_types: [
    "terminal:TerminalAction",
    "terminal:TerminalObservation", 
    "file_editor:FileEditorAction",
    "file_editor:FileEditorObservation",
    "think:ThinkAction",
    "think:ThinkObservation",
    "invoke_skill:InvokeSkillAction",
    "invoke_skill:InvokeSkillObservation"
  ],
  events: [
    // Terminal Action
    {
      id: "test-action-001",
      timestamp: "2026-01-01T12:00:00.000000",
      source: "agent",
      kind: "ActionEvent",
      tool_name: "terminal",
      tool_call_id: "toolu_test001",
      summary: "List files in current directory",
      action: {
        command: "ls -la",
        is_input: false,
        timeout: null,
        reset: false,
        kind: "TerminalAction"
      }
    },
    // Terminal Observation
    {
      id: "test-obs-001",
      timestamp: "2026-01-01T12:00:01.000000",
      source: "environment",
      kind: "ObservationEvent",
      tool_name: "terminal",
      tool_call_id: "toolu_test001",
      action_id: "test-action-001",
      observation: {
        content: [{ type: "text", text: "total 8\ndrwxr-xr-x 2 user user 4096 Jan 1 12:00 .\n-rw-r--r-- 1 user user  100 Jan 1 12:00 README.md" }],
        is_error: false,
        command: "ls -la",
        exit_code: 0,
        timeout: false,
        kind: "TerminalObservation"
      }
    },
    // Terminal Error
    {
      id: "test-action-002",
      timestamp: "2026-01-01T12:01:00.000000",
      source: "agent",
      kind: "ActionEvent",
      tool_name: "terminal",
      tool_call_id: "toolu_test002",
      summary: "Read nonexistent file",
      action: {
        command: "cat /nonexistent.txt",
        kind: "TerminalAction"
      }
    },
    {
      id: "test-obs-002",
      timestamp: "2026-01-01T12:01:01.000000",
      source: "environment",
      kind: "ObservationEvent",
      tool_name: "terminal",
      action_id: "test-action-002",
      observation: {
        content: [{ type: "text", text: "cat: /nonexistent.txt: No such file or directory" }],
        is_error: true,
        exit_code: 1,
        kind: "TerminalObservation"
      }
    },
    // File Editor Action (view)
    {
      id: "test-action-003",
      timestamp: "2026-01-01T12:02:00.000000",
      source: "agent",
      kind: "ActionEvent",
      tool_name: "file_editor",
      tool_call_id: "toolu_test003",
      summary: "View README.md file",
      action: {
        command: "view",
        path: "/workspace/README.md",
        kind: "FileEditorAction"
      }
    },
    {
      id: "test-obs-003",
      timestamp: "2026-01-01T12:02:01.000000",
      source: "environment",
      kind: "ObservationEvent",
      tool_name: "file_editor",
      action_id: "test-action-003",
      observation: {
        content: [{ type: "text", text: "# Project README\n\nThis is a test project." }],
        is_error: false,
        path: "/workspace/README.md",
        kind: "FileEditorObservation"
      }
    },
    // File Editor Action (str_replace)
    {
      id: "test-action-004",
      timestamp: "2026-01-01T12:03:00.000000",
      source: "agent",
      kind: "ActionEvent",
      tool_name: "file_editor",
      tool_call_id: "toolu_test004",
      summary: "Update README title",
      action: {
        command: "str_replace",
        path: "/workspace/README.md",
        old_str: "# Project README",
        new_str: "# My Awesome Project",
        kind: "FileEditorAction"
      }
    },
    {
      id: "test-obs-004",
      timestamp: "2026-01-01T12:03:01.000000",
      source: "environment",
      kind: "ObservationEvent",
      tool_name: "file_editor",
      action_id: "test-action-004",
      observation: {
        content: [{ type: "text", text: "File updated successfully" }],
        is_error: false,
        path: "/workspace/README.md",
        kind: "FileEditorObservation"
      }
    },
    // Think Action
    {
      id: "test-action-005",
      timestamp: "2026-01-01T12:04:00.000000",
      source: "agent",
      kind: "ActionEvent",
      tool_name: "think",
      tool_call_id: "toolu_test005",
      summary: "Analyze the problem",
      action: {
        thought: "I need to analyze this bug. The issue seems to be in the event handling code where the kind field is not being properly extracted from nested objects.",
        kind: "ThinkAction"
      }
    },
    {
      id: "test-obs-005",
      timestamp: "2026-01-01T12:04:01.000000",
      source: "environment",
      kind: "ObservationEvent",
      tool_name: "think",
      action_id: "test-action-005",
      observation: {
        content: [{ type: "text", text: "Thought recorded." }],
        is_error: false,
        kind: "ThinkObservation"
      }
    },
    // Invoke Skill Action
    {
      id: "test-action-006",
      timestamp: "2026-01-01T12:05:00.000000",
      source: "agent",
      kind: "ActionEvent",
      tool_name: "invoke_skill",
      tool_call_id: "toolu_test006",
      summary: "Invoke the github skill",
      action: {
        name: "github",
        kind: "InvokeSkillAction"
      }
    },
    {
      id: "test-obs-006",
      timestamp: "2026-01-01T12:05:01.000000",
      source: "environment",
      kind: "ObservationEvent",
      tool_name: "invoke_skill",
      action_id: "test-action-006",
      observation: {
        content: [{ type: "text", text: "Skill 'github' invoked successfully." }],
        is_error: false,
        skill_name: "github",
        kind: "InvokeSkillObservation"
      }
    }
  ]
};

fs.writeFileSync(
  'test-fixtures/clean-fixtures.json',
  JSON.stringify(cleanFixtures, null, 2)
);

console.log('Created clean-fixtures.json with', cleanFixtures.events.length, 'events');
console.log('Event types covered:', cleanFixtures.event_types.join(', '));
