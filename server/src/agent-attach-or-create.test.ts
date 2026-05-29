/**
 * Tests for the shared `attachOrCreateAgentSession` helper (issue #348).
 *
 * The helper is the single place where the rehydration pass and
 * auto-connect path recover from `UpstreamConversationEndedError` by
 * spawning a fresh upstream conversation. The behaviour contract these
 * tests pin:
 *
 *   1. Happy path — driver returns a status; helper persists the id and
 *      reports `freshCreated: false`.
 *   2. Attach failed with `UpstreamConversationEndedError`, fresh-create
 *      succeeded — helper stashes the dead id, clears the live pointer,
 *      retries WITHOUT `existingConversationId`, persists the new id,
 *      reports `freshCreated: true`.
 *   3. Attach failed with a non-`UpstreamConversationEndedError` — helper
 *      propagates the original error; NO metadata mutation, NO retry,
 *      NO persist.
 *   4. Attach failed with `UpstreamConversationEndedError`, fresh-create
 *      ALSO failed — helper propagates the second error; metadata is
 *      still cleared (we know the old id is dead); NO infinite loop.
 *   5. Opts with no `existingConversationId` — even an
 *      `UpstreamConversationEndedError` cannot trigger retry (there’s
 *      nothing to fall back from).
 *   6. Persist-before-broadcast invariant (#347): on both success paths,
 *      `persistAiConversationId` (which writes to `sessionRepository`)
 *      is called BEFORE the helper returns, so the caller’s broadcast
 *      always sees the durable id.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { attachOrCreateAgentSession } from './agent-attach-or-create.js';
import { UpstreamConversationEndedError } from './openhands.js';
import type { AgentDriver, AgentSessionStatus, OpenSessionOpts } from './agent-driver/index.js';
import type { SessionRepository } from './sessions/index.js';

function readyStatus(sessionId: string, conversationId: string | null): AgentSessionStatus {
  return {
    sessionId,
    state: 'ready',
    conversationId,
    error: null,
    thinkingSince: null,
    startingSince: null,
  };
}

interface DriverFake {
  driver: AgentDriver;
  /** Each call records the opts the helper passed in. */
  calls: OpenSessionOpts[];
}

/**
 * Build a fake driver that runs a script of responses. Each script entry
 * is either a thrown error or a returned status; the entry consumed
 * matches the call index (first entry → first call, etc.).
 */
function fakeDriver(
  script: ReadonlyArray<{ throw: Error } | { return: AgentSessionStatus }>,
): DriverFake {
  const calls: OpenSessionOpts[] = [];
  let i = 0;
  const driver = {
    isAvailable: vi.fn().mockReturnValue(true),
    hasSession: vi.fn().mockReturnValue(false),
    openSession: vi.fn(async (_sessionId: string, opts: OpenSessionOpts) => {
      calls.push(opts);
      const entry = script[i++];
      if (!entry) throw new Error(`script exhausted at call ${i}`);
      if ('throw' in entry) throw entry.throw;
      return entry.return;
    }),
    sendMessage: vi.fn(),
    restartSession: vi.fn(),
    getSessionStatus: vi.fn(),
    closeSession: vi.fn(),
  } as unknown as AgentDriver;
  return { driver, calls };
}

/** Minimal mock of the SessionRepository surface the helper touches. */
function fakeRepo() {
  return {
    updateMetadata: vi.fn(),
    findById: vi.fn(),
  } as unknown as SessionRepository;
}

const SID = 'session-X';
const WSID = 'ws-X';

describe('attachOrCreateAgentSession (#348)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('happy path: driver returns status, helper persists id and reports freshCreated=false', async () => {
    const { driver, calls } = fakeDriver([
      { return: readyStatus(SID, 'conv-attached') },
    ]);
    const repo = fakeRepo();

    const result = await attachOrCreateAgentSession(
      SID,
      { workspaceId: WSID, existingConversationId: 'conv-attached' },
      { agentDriver: driver, sessionRepository: repo },
    );

    expect(result.freshCreated).toBe(false);
    expect(result.status.conversationId).toBe('conv-attached');
    // Driver was called exactly once — no retry.
    expect(calls).toHaveLength(1);
    expect(calls[0].existingConversationId).toBe('conv-attached');
    // Persisted the (re-)attached id BEFORE returning.
    expect(repo.updateMetadata).toHaveBeenCalledTimes(1);
    expect(repo.updateMetadata).toHaveBeenCalledWith(SID, {
      aiConversationId: 'conv-attached',
    });
  });

  it('attach fails with UpstreamConversationEndedError, fresh-create succeeds: stash, retry, persist, freshCreated=true', async () => {
    const dead = new UpstreamConversationEndedError('conv-dead');
    const { driver, calls } = fakeDriver([
      { throw: dead },
      { return: readyStatus(SID, 'conv-new') },
    ]);
    const repo = fakeRepo();

    const result = await attachOrCreateAgentSession(
      SID,
      { workspaceId: WSID, existingConversationId: 'conv-dead' },
      { agentDriver: driver, sessionRepository: repo },
    );

    expect(result.freshCreated).toBe(true);
    expect(result.status.conversationId).toBe('conv-new');

    // Two driver calls: first WITH existing, second WITHOUT — but the
    // dead id is forwarded as `previousConversationId` so #349's
    // carry-forward replay path can seed the new conversation's context.
    expect(calls).toHaveLength(2);
    expect(calls[0].existingConversationId).toBe('conv-dead');
    expect(calls[1]).not.toHaveProperty('existingConversationId');
    expect(calls[1].previousConversationId).toBe('conv-dead');
    expect(calls[1].workspaceId).toBe(WSID);

    // Metadata writes (ordering matters):
    //   1. Stash dead id + clear live pointer.
    //   2. Persist new id.
    // `updateMetadata` is called exactly twice in that order.
    expect(repo.updateMetadata).toHaveBeenCalledTimes(2);
    const calls_ = (repo.updateMetadata as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls_[0]).toEqual([
      SID,
      { aiConversationId: undefined, previousAiConversationId: 'conv-dead' },
    ]);
    expect(calls_[1]).toEqual([SID, { aiConversationId: 'conv-new' }]);
  });

  it('attach fails with a non-Upstream error: propagates, no retry, no metadata mutation', async () => {
    const generic = new Error('network blip');
    const { driver, calls } = fakeDriver([{ throw: generic }]);
    const repo = fakeRepo();

    await expect(
      attachOrCreateAgentSession(
        SID,
        { workspaceId: WSID, existingConversationId: 'conv-x' },
        { agentDriver: driver, sessionRepository: repo },
      ),
    ).rejects.toBe(generic);

    expect(calls).toHaveLength(1);
    expect(repo.updateMetadata).not.toHaveBeenCalled();
  });

  it('attach fails with UpstreamConversationEnded, fresh-create ALSO fails: propagates retry error, no third call, metadata still cleared', async () => {
    const dead = new UpstreamConversationEndedError('conv-dead');
    const retryErr = new Error('fresh create failed');
    const { driver, calls } = fakeDriver([
      { throw: dead },
      { throw: retryErr },
    ]);
    const repo = fakeRepo();

    await expect(
      attachOrCreateAgentSession(
        SID,
        { workspaceId: WSID, existingConversationId: 'conv-dead' },
        { agentDriver: driver, sessionRepository: repo },
      ),
    ).rejects.toBe(retryErr);

    // Exactly two driver calls — no third retry, no infinite loop.
    expect(calls).toHaveLength(2);
    // Metadata stash happened before the second call.
    expect(repo.updateMetadata).toHaveBeenCalledTimes(1);
    expect(repo.updateMetadata).toHaveBeenCalledWith(SID, {
      aiConversationId: undefined,
      previousAiConversationId: 'conv-dead',
    });
  });

  it('opts without existingConversationId: UpstreamConversationEnded propagates with NO retry, NO metadata mutation', async () => {
    const dead = new UpstreamConversationEndedError('conv-orphan');
    const { driver, calls } = fakeDriver([{ throw: dead }]);
    const repo = fakeRepo();

    await expect(
      attachOrCreateAgentSession(
        SID,
        { workspaceId: WSID }, // no existingConversationId
        { agentDriver: driver, sessionRepository: repo },
      ),
    ).rejects.toBe(dead);

    expect(calls).toHaveLength(1);
    expect(repo.updateMetadata).not.toHaveBeenCalled();
  });

  it('fresh-create branch threads non-attach opts through verbatim (apiKey, displayApiSecret, displayLines)', async () => {
    const dead = new UpstreamConversationEndedError('conv-dead');
    const { driver, calls } = fakeDriver([
      { throw: dead },
      { return: readyStatus(SID, 'conv-fresh') },
    ]);
    const repo = fakeRepo();

    await attachOrCreateAgentSession(
      SID,
      {
        workspaceId: WSID,
        existingConversationId: 'conv-dead',
        apiKey: 'k',
        displayApiSecret: 'd',
        displayLines: 7,
      },
      { agentDriver: driver, sessionRepository: repo },
    );

    expect(calls).toHaveLength(2);
    // The dead id is now also forwarded as `previousConversationId` so
    // the OH adapter can build a memory-replay suffix from the prior
    // conversation's event log (#349).
    expect(calls[1]).toEqual({
      workspaceId: WSID,
      apiKey: 'k',
      displayApiSecret: 'd',
      displayLines: 7,
      previousConversationId: 'conv-dead',
    });
  });

  it('metadata-stash failure is non-fatal: fresh-create still proceeds', async () => {
    const dead = new UpstreamConversationEndedError('conv-dead');
    const { driver, calls } = fakeDriver([
      { throw: dead },
      { return: readyStatus(SID, 'conv-new') },
    ]);
    const repo = fakeRepo();
    // First write throws; second (persist) succeeds.
    (repo.updateMetadata as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(() => {
        throw new Error('DB locked');
      })
      .mockReturnValue(null);
    // Silence the console.error the helper emits on the stash failure.
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await attachOrCreateAgentSession(
      SID,
      { workspaceId: WSID, existingConversationId: 'conv-dead' },
      { agentDriver: driver, sessionRepository: repo },
    );

    expect(result.freshCreated).toBe(true);
    expect(result.status.conversationId).toBe('conv-new');
    expect(calls).toHaveLength(2);
    // Both metadata writes attempted: stash (throws) and persist (succeeds).
    expect(repo.updateMetadata).toHaveBeenCalledTimes(2);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  // ───── #349: carry-forward of previousConversationId on fresh-create ─────
  //
  // The helper's contract for #349's memory-replay carry-forward is narrow:
  //   - On `freshCreated === true`, the retry opts MUST carry the dead id
  //     as `previousConversationId` so the OH adapter can build a
  //     memory-replay suffix from the prior conversation's event log.
  //   - On `freshCreated === false` (happy-path attach), the helper MUST
  //     NOT inject `previousConversationId` — replay is irrelevant when
  //     the on-server event log is already preserved by the attach.
  //   - The helper does not call `buildReplaySuffix` itself; it only
  //     passes the hint through. Tests below assert the wiring, not the
  //     suffix construction (covered by `replay.test.ts`).
  //
  // Cause-conversation-id precedence: when `UpstreamConversationEndedError`
  // carries an explicit `conversationId`, that wins over
  // `opts.existingConversationId` (the helper already uses
  // `cause.conversationId || opts.existingConversationId`). Locked here
  // so future refactors can't silently swap the precedence.

  it('#349: freshCreated=true forwards opts.existingConversationId as previousConversationId on the retry', async () => {
    const dead = new UpstreamConversationEndedError(''); // empty cause id → fall back to opts
    const { driver, calls } = fakeDriver([
      { throw: dead },
      { return: readyStatus(SID, 'conv-new') },
    ]);
    const repo = fakeRepo();

    const result = await attachOrCreateAgentSession(
      SID,
      { workspaceId: WSID, existingConversationId: 'conv-dead-from-opts' },
      { agentDriver: driver, sessionRepository: repo },
    );

    expect(result.freshCreated).toBe(true);
    expect(calls[1].previousConversationId).toBe('conv-dead-from-opts');
  });

  it('#349: freshCreated=true prefers cause.conversationId over opts.existingConversationId for previousConversationId', async () => {
    // When the upstream error carries an explicit conversation id, that's
    // the most accurate "the upstream said THIS one is dead" signal, so
    // it wins over the (possibly stale) opts value.
    const dead = new UpstreamConversationEndedError('conv-dead-from-cause');
    const { driver, calls } = fakeDriver([
      { throw: dead },
      { return: readyStatus(SID, 'conv-new') },
    ]);
    const repo = fakeRepo();

    await attachOrCreateAgentSession(
      SID,
      { workspaceId: WSID, existingConversationId: 'conv-dead-from-opts' },
      { agentDriver: driver, sessionRepository: repo },
    );

    expect(calls[1].previousConversationId).toBe('conv-dead-from-cause');
  });

  it('#349: freshCreated=false (happy attach) does NOT inject previousConversationId', async () => {
    // Attach succeeded — the on-server event log is preserved across
    // rebinds, replay is irrelevant. Don't pollute the opts with a
    // hint the driver / manager will quietly ignore.
    const { driver, calls } = fakeDriver([
      { return: readyStatus(SID, 'conv-attached') },
    ]);
    const repo = fakeRepo();

    const result = await attachOrCreateAgentSession(
      SID,
      { workspaceId: WSID, existingConversationId: 'conv-attached' },
      { agentDriver: driver, sessionRepository: repo },
    );

    expect(result.freshCreated).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0]).not.toHaveProperty('previousConversationId');
  });

  it('#349: caller-supplied previousConversationId on attach path is forwarded verbatim (not stripped)', async () => {
    // Defensive: if a future caller passes `previousConversationId` on a
    // plain attach (no fresh-create), the helper threads it through
    // unchanged. Today only the fresh-create branch sets it, but the
    // type permits both — make sure the pass-through stays cheap.
    const { driver, calls } = fakeDriver([
      { return: readyStatus(SID, 'conv-attached') },
    ]);
    const repo = fakeRepo();

    await attachOrCreateAgentSession(
      SID,
      {
        workspaceId: WSID,
        existingConversationId: 'conv-attached',
        previousConversationId: 'conv-prior',
      },
      { agentDriver: driver, sessionRepository: repo },
    );

    expect(calls[0].previousConversationId).toBe('conv-prior');
  });

  it('happy path with no conversationId in status: persist is a no-op', async () => {
    // Defensive: persistAiConversationId is a no-op when status.conversationId
    // is null. The helper should still report freshCreated=false and not
    // mutate metadata.
    const { driver } = fakeDriver([
      { return: readyStatus(SID, null) },
    ]);
    const repo = fakeRepo();

    const result = await attachOrCreateAgentSession(
      SID,
      { workspaceId: WSID, existingConversationId: 'conv-x' },
      { agentDriver: driver, sessionRepository: repo },
    );

    expect(result.freshCreated).toBe(false);
    expect(result.status.conversationId).toBeNull();
    expect(repo.updateMetadata).not.toHaveBeenCalled();
  });
});
