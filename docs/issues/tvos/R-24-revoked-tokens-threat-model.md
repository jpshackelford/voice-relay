# R-24 — Threat model for the revoked-tokens store

## Research question

What persistence mechanism for the deny list in **B-02** strikes
the right balance of correctness, latency, and operational
simplicity for our current scale and threat model?

## Why we need to know this

**B-02** specifies the wire contract for revocation but
deliberately punts on the storage mechanism. Options span at
least:

1. A SQL table consulted on every authenticated request.
2. An in-process LRU keyed by `jti` (lost on restart).
3. A small Redis/equivalent shared cache.

Each has different correctness, latency, and operational
properties. Picking the wrong one now is recoverable but costs a
migration; picking the right one needs to be informed by a
written threat model, not vibes.

## Approach

- Write a short threat model: who can revoke, who can be
  revoked, what is the attack a revoke prevents, what is the
  worst case of a missed revocation, what is the latency
  budget for revocation taking effect, and what is the storage
  cost ceiling of the deny list at our current scale.
- Compare the three options against the threat model.
- Note operational requirements (cron / reaper job, backup
  story, recovery story on restart) for each.

## Scope guardrails

- Document-only investigation.
- No new dependencies introduced during the spike.

## Deliverable

A comment on this issue containing:

- The threat model write-up.
- A recommended persistence mechanism and reaper strategy.
- Recommendations roll into the **B-02** followup as the
  technical implementation plan.
