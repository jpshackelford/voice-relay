# Voice Relay Workflow Log

This file tracks orchestrator activity and human instructions for the voice-relay project.

## Workflow

The orchestrator works through **GitHub Issues** filed against this repository, one at a time:

1. Pick the next open issue (lowest number first)
2. Implement, test, create PR
3. Address reviews until merged
4. Move to next issue
5. Repeat until all issues are complete

**Current backlog:**
- [#9 - F1: Scope messages to sessions](https://github.com/jpshackelford/voice-relay/issues/9)
- [#10 - F2: Replace Dashboard with Workspace Home](https://github.com/jpshackelford/voice-relay/issues/10)
- [#11 - F3: Session View (remove setup, auto-detect mode, QR idle state)](https://github.com/jpshackelford/voice-relay/issues/11)
- [#12 - F4: Join session via QR code](https://github.com/jpshackelford/voice-relay/issues/12)

## How to Use

**Human instructions:** Add an entry like this and the orchestrator will follow it:
```markdown
## INSTRUCTION: Your instruction here
```

The orchestrator will acknowledge with `[ACKNOWLEDGED]` once processed.

---

## Log

### 2026-05-05 23:40 UTC - Workflow Reset

🔄 **Workflow transitioned from design-doc-based to issue-based**

- Previous worklog archived to `WORKLOG_ARCHIVE_2026-05-05.md`
- Now working from GitHub Issues instead of `docs/DESIGN.md` phases
- Next action: Begin work on Issue #9 (Scope messages to sessions)

---
### 2026-05-05 23:46 UTC - Orchestrator

⏳ **Waiting** - Active conversations detected

**Current State:**
- No open PRs
- Open issues: #9, #10, #11, #12 (starting with #9: F1: Scope messages to sessions)

**Active Conversations:**
- `c654b08` (3m idle) - "🔧 Execute Plan from PLAN.md File" - still setting up workflow
- `c839251` (6m idle) - "🐛 Debug Voice Relay Node.js Auth Routes" - debugging

**Action Taken:**
None - waiting for active conversations to complete (idle < 15 min threshold)

**Next Steps:**
Will check again in ~30 minutes. If conversations are quiet, will spawn implementation worker for Issue #9.

---
