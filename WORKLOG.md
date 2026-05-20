---
### 2026-05-20 12:17 UTC - Implementation Worker

**Completed: Issue #246 - QR code dismissed without user interaction**

- Issue: [#246 - bug: QR code dismissed without user interaction](https://github.com/jpshackelford/voice-relay/issues/246)
- PR: [#248 - fix(client): queue display content when QR code has priority](https://github.com/jpshackelford/voice-relay/pull/248)
- Status: Ready for review (CI passing)

**Implementation Summary:**
- Added `queuedDisplayContent` state to hold incoming display content when QR has priority
- Added `qrHasPriority` flag (true when no mobile devices AND not dismissed)
- Computed `effectiveDisplayContent` to show actual content only when QR is resolved
- Updated image timeout effect to use effectiveDisplayContent
- Updated render logic to use effectiveDisplayContent

**Tests Added:**
- Queue displayContent when no mobile devices (QR has priority)
- Show queued content after QR is dismissed (Skip button)
- Show queued content when mobile device joins
- Updated existing image display tests to work with new queueing behavior

All 472 client tests and 681 server tests passing.

