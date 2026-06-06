/**
 * Issue #412: Workspace settings UI for hosted-STT engine, cap, key,
 * and usage. This test exercises the new STT panel rendered by
 * `WorkspaceHome` via real hook code paths — fetch is the only seam.
 *
 * Scope: engine flip (web-speech / deepgram), monthly minute cap entry,
 * Deepgram key set + clear, and the current-month usage display. These
 * are the four operator surfaces the issue calls out.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, within, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { WorkspaceHome } from './WorkspaceHome';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

// Owner auth state — the STT section only renders for owners. The
// AuthContext mock MUST return a stable object reference across renders
// — otherwise every internal `useCallback` that depends on
// `ensureValidToken` re-creates itself, which retriggers `useEffect`s,
// which re-fetch, which re-render… infinite loop. (Hit this the hard
// way at #412 — keep this stable.)
const stableAuthState = {
  user: { id: 'u1', username: 'owner', displayName: 'Owner', avatarUrl: null, email: null },
  loading: false,
  login: () => {},
  logout: () => {},
  isAuthenticated: true,
  ensureValidToken: async () => true,
};

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => stableAuthState,
}));

// Avoid pulling in the real ReleaseNotes (and its markdown deps) — it's
// off-screen for these tests and renders nothing relevant to the STT
// panel.
vi.mock('../components/ReleaseNotes', () => ({
  ReleaseNotes: () => null,
}));

vi.mock('../components/DeleteWorkspaceModal', () => ({
  DeleteWorkspaceModal: () => null,
}));

interface FetchScript {
  workspaces?: Array<{
    id: string;
    ownerId: string;
    name: string;
    slug: string;
    joinCode: string | null;
    createdAt: string;
    updatedAt: string | null;
    isOwner: boolean;
  }>;
  settings?: Record<string, unknown>;
  usage?: { workspaceId: string; minutesUsedThisMonth: number; cap: number | null; engine: 'web-speech' | 'deepgram' };
}

/**
 * Stand up a fetch mock that handles every endpoint WorkspaceHome
 * touches on mount + during STT interactions. Returns a `calls` array
 * so individual tests can assert the issued requests, and a
 * `setSettings` updater for simulating PATCH responses.
 */
function makeFetchMock(initial: FetchScript) {
  let settings: Record<string, unknown> = {
    workspaceId: 'ws1',
    hasApiKey: false,
    ttsVoice: null,
    sttLanguage: null,
    allowAutoJoin: true,
    requireQrToken: false,
    hasElevenlabsApiKey: false,
    elevenlabsVoiceId: null,
    elevenlabsTtsEnabled: false,
    kioskFooterTickersEnabled: false,
    sttEngine: 'web-speech',
    sttMonthlyMinuteCap: null,
    hasDeepgramApiKey: false,
    updatedAt: '2026-01-01T00:00:00Z',
    ...(initial.settings ?? {}),
  };
  const workspaces = initial.workspaces ?? [{
    id: 'ws1',
    ownerId: 'u1',
    name: 'Test Workspace',
    slug: 'test',
    joinCode: 'JOIN-CODE',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: null,
    isOwner: true,
  }];
  let usage = initial.usage ?? {
    workspaceId: 'ws1',
    minutesUsedThisMonth: 0,
    cap: null,
    engine: 'web-speech' as const,
  };

  const calls: Array<{ url: string; method: string; body: unknown }> = [];

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    calls.push({ url, method, body });

    // Health endpoint
    if (url === '/health') {
      return new Response(JSON.stringify({ version: 'test' }), { status: 200 });
    }
    // Workspaces list — hook expects the array directly.
    if (url === '/api/workspaces' && method === 'GET') {
      return new Response(JSON.stringify(workspaces), { status: 200 });
    }
    // Sessions list — hook reads `data.sessions`.
    if (url.startsWith('/api/workspaces/ws1/sessions') && method === 'GET') {
      return new Response(JSON.stringify({ sessions: [] }), { status: 200 });
    }
    // Auto-create session POST: WorkspaceHome auto-creates if list is
    // empty. Return a stub wrapped as `{session: ...}` (hook contract).
    if (url.startsWith('/api/workspaces/ws1/sessions') && method === 'POST') {
      return new Response(JSON.stringify({
        session: {
          id: 'sess1',
          workspaceId: 'ws1',
          name: 'Default',
          status: 'active',
          startedAt: '2026-01-01T00:00:00Z',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: null,
        },
      }), { status: 200 });
    }
    // Devices list — hook reads `data.devices`.
    if (url.startsWith('/api/workspaces/ws1/devices') && method === 'GET') {
      return new Response(JSON.stringify({ devices: [] }), { status: 200 });
    }
    // Settings get / patch
    if (url === '/api/workspaces/ws1/settings' && method === 'GET') {
      return new Response(JSON.stringify(settings), { status: 200 });
    }
    if (url === '/api/workspaces/ws1/settings' && method === 'PATCH') {
      settings = { ...settings, ...(body as Record<string, unknown>) };
      // engine flip should also surface in usage snapshot
      if (body && 'sttEngine' in body) {
        usage = { ...usage, engine: settings.sttEngine as 'web-speech' | 'deepgram' };
      }
      if (body && 'sttMonthlyMinuteCap' in body) {
        usage = { ...usage, cap: settings.sttMonthlyMinuteCap as number | null };
      }
      return new Response(JSON.stringify(settings), { status: 200 });
    }
    // Deepgram key PUT / DELETE
    if (url === '/api/workspaces/ws1/settings/deepgram-api-key' && method === 'PUT') {
      settings = { ...settings, hasDeepgramApiKey: true };
      return new Response(JSON.stringify({ success: true, hasDeepgramApiKey: true }), { status: 200 });
    }
    if (url === '/api/workspaces/ws1/settings/deepgram-api-key' && method === 'DELETE') {
      // Server resets the engine on key removal — mirror that.
      settings = { ...settings, hasDeepgramApiKey: false, sttEngine: 'web-speech' };
      usage = { ...usage, engine: 'web-speech' };
      return new Response(null, { status: 204 });
    }
    // STT usage
    if (url.startsWith('/api/stt/usage') && method === 'GET') {
      return new Response(JSON.stringify(usage), { status: 200 });
    }
    // ElevenLabs voices (not exercised here; respond empty)
    if (url.includes('/elevenlabs-voices') && method === 'GET') {
      return new Response(JSON.stringify({ voices: [] }), { status: 200 });
    }
    return new Response(JSON.stringify({ error: 'unexpected fetch in test: ' + url }), { status: 500 });
  });

  return {
    fetchMock,
    calls,
    getSettings: () => settings,
    getUsage: () => usage,
    setUsage: (u: typeof usage) => {
      usage = u;
    },
  };
}

function renderWorkspaceHome() {
  return render(
    <MemoryRouter initialEntries={['/workspace/ws1']}>
      <Routes>
        <Route path="/workspace/:workspaceId" element={<WorkspaceHome />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('WorkspaceHome — issue #412 STT settings UI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the hosted-STT engine selector with web-speech selected by default', async () => {
    const harness = makeFetchMock({});
    global.fetch = harness.fetchMock as unknown as typeof fetch;

    renderWorkspaceHome();

    const section = await screen.findByTestId('stt-engine-setting');
    expect(within(section).getByText(/Speech recognition engine/i)).toBeDefined();
    const webSpeech = within(section).getByDisplayValue('web-speech') as HTMLInputElement;
    const deepgram = within(section).getByDisplayValue('deepgram') as HTMLInputElement;
    expect(webSpeech.checked).toBe(true);
    expect(deepgram.checked).toBe(false);
    // No Deepgram key configured — selecting Deepgram should be locked
    // behind setting a key first.
    expect(deepgram.disabled).toBe(true);
    expect(within(section).getByText(/set an API key below first/i)).toBeDefined();
  });

  it('flips the engine to deepgram once a key is configured, then back', async () => {
    const harness = makeFetchMock({ settings: { hasDeepgramApiKey: true } });
    global.fetch = harness.fetchMock as unknown as typeof fetch;

    renderWorkspaceHome();

    const section = await screen.findByTestId('stt-engine-setting');
    // Settings load asynchronously; wait for hasDeepgramApiKey=true to
    // propagate so the radio is enabled.
    await waitFor(() => {
      const dg = within(screen.getByTestId('stt-engine-setting'))
        .getByDisplayValue('deepgram') as HTMLInputElement;
      expect(dg.disabled).toBe(false);
    });
    const deepgram = within(section).getByDisplayValue('deepgram') as HTMLInputElement;

    await act(async () => {
      fireEvent.click(deepgram);
    });

    await waitFor(() => {
      expect(harness.calls.some(
        (c) => c.url === '/api/workspaces/ws1/settings'
          && c.method === 'PATCH'
          && (c.body as { sttEngine: string }).sttEngine === 'deepgram',
      )).toBe(true);
    });

    await waitFor(() => {
      const dgRadio = within(screen.getByTestId('stt-engine-setting'))
        .getByDisplayValue('deepgram') as HTMLInputElement;
      expect(dgRadio.checked).toBe(true);
    });

    // Flip back to web-speech
    const webSpeech = within(screen.getByTestId('stt-engine-setting'))
      .getByDisplayValue('web-speech') as HTMLInputElement;
    await act(async () => {
      fireEvent.click(webSpeech);
    });

    await waitFor(() => {
      expect(harness.calls.some(
        (c) => c.url === '/api/workspaces/ws1/settings'
          && c.method === 'PATCH'
          && (c.body as { sttEngine: string }).sttEngine === 'web-speech',
      )).toBe(true);
    });
  });

  it('persists a numeric monthly cap and clears it back to null when emptied', async () => {
    const harness = makeFetchMock({ settings: { hasDeepgramApiKey: true, sttEngine: 'deepgram' } });
    global.fetch = harness.fetchMock as unknown as typeof fetch;

    renderWorkspaceHome();

    const capSection = await screen.findByTestId('stt-cap-setting');
    const input = within(capSection).getByLabelText(/Monthly Deepgram minute cap/i) as HTMLInputElement;
    const saveBtn = within(capSection).getByRole('button', { name: /^Save$/ });

    await act(async () => {
      fireEvent.change(input, { target: { value: '60' } });
      fireEvent.click(saveBtn);
    });

    await waitFor(() => {
      const patchCall = harness.calls.find(
        (c) => c.url === '/api/workspaces/ws1/settings'
          && c.method === 'PATCH'
          && (c.body as Record<string, unknown>).sttMonthlyMinuteCap !== undefined,
      );
      expect(patchCall).toBeDefined();
      expect((patchCall!.body as { sttMonthlyMinuteCap: number }).sttMonthlyMinuteCap).toBe(60);
    });

    // Now clear the cap — empty string means null on the server.
    await act(async () => {
      fireEvent.change(input, { target: { value: '' } });
      fireEvent.click(saveBtn);
    });

    await waitFor(() => {
      const clearCall = harness.calls.filter(
        (c) => c.url === '/api/workspaces/ws1/settings'
          && c.method === 'PATCH'
          && Object.prototype.hasOwnProperty.call(c.body as object, 'sttMonthlyMinuteCap'),
      ).pop();
      expect(clearCall).toBeDefined();
      expect((clearCall!.body as { sttMonthlyMinuteCap: number | null }).sttMonthlyMinuteCap).toBeNull();
    });
  });

  it('rejects a non-integer cap with a local error message and does not PATCH', async () => {
    const harness = makeFetchMock({ settings: { hasDeepgramApiKey: true, sttEngine: 'deepgram' } });
    global.fetch = harness.fetchMock as unknown as typeof fetch;

    renderWorkspaceHome();

    const capSection = await screen.findByTestId('stt-cap-setting');
    const input = within(capSection).getByLabelText(/Monthly Deepgram minute cap/i) as HTMLInputElement;
    const saveBtn = within(capSection).getByRole('button', { name: /^Save$/ });

    // Track PATCH calls that target the cap key only.
    const capPatchCountBefore = harness.calls.filter(
      (c) => c.url === '/api/workspaces/ws1/settings'
        && c.method === 'PATCH'
        && Object.prototype.hasOwnProperty.call(c.body as object, 'sttMonthlyMinuteCap'),
    ).length;

    await act(async () => {
      fireEvent.change(input, { target: { value: '3.5' } });
      fireEvent.click(saveBtn);
    });

    expect(
      within(capSection).getByText(/non-negative whole number/i),
    ).toBeDefined();

    const capPatchCountAfter = harness.calls.filter(
      (c) => c.url === '/api/workspaces/ws1/settings'
        && c.method === 'PATCH'
        && Object.prototype.hasOwnProperty.call(c.body as object, 'sttMonthlyMinuteCap'),
    ).length;
    expect(capPatchCountAfter).toBe(capPatchCountBefore);
  });

  it('sets the Deepgram API key, then removes it (with confirm)', async () => {
    const harness = makeFetchMock({});
    global.fetch = harness.fetchMock as unknown as typeof fetch;

    renderWorkspaceHome();

    const keySection = await screen.findByTestId('deepgram-api-key-setting');
    expect(within(keySection).getByText(/Not Configured/i)).toBeDefined();

    const keyInput = within(keySection).getByLabelText('Deepgram API key') as HTMLInputElement;
    const saveBtn = within(keySection).getByRole('button', { name: /^Save$/ });

    await act(async () => {
      fireEvent.change(keyInput, { target: { value: 'dg-secret-key' } });
      fireEvent.click(saveBtn);
    });

    await waitFor(() => {
      const putCall = harness.calls.find(
        (c) => c.url === '/api/workspaces/ws1/settings/deepgram-api-key' && c.method === 'PUT',
      );
      expect(putCall).toBeDefined();
      expect((putCall!.body as { apiKey: string }).apiKey).toBe('dg-secret-key');
    });

    await waitFor(() => {
      expect(within(screen.getByTestId('deepgram-api-key-setting')).getByText(/✓ Configured/)).toBeDefined();
    });

    // The plaintext value should NOT round-trip back from the server —
    // the input is cleared after save.
    const refreshedInput = within(screen.getByTestId('deepgram-api-key-setting'))
      .getByLabelText('Deepgram API key') as HTMLInputElement;
    expect(refreshedInput.value).toBe('');

    // Remove the key with confirm() approval. happy-dom doesn't ship
    // a usable window.confirm by default, so install one directly.
    const originalConfirm = window.confirm;
    window.confirm = () => true;
    const removeBtn = within(screen.getByTestId('deepgram-api-key-setting'))
      .getByRole('button', { name: /^Remove$/ });

    await act(async () => {
      fireEvent.click(removeBtn);
    });

    await waitFor(() => {
      const delCall = harness.calls.find(
        (c) => c.url === '/api/workspaces/ws1/settings/deepgram-api-key' && c.method === 'DELETE',
      );
      expect(delCall).toBeDefined();
    });

    await waitFor(() => {
      expect(within(screen.getByTestId('deepgram-api-key-setting')).getByText(/Not Configured/)).toBeDefined();
    });

    window.confirm = originalConfirm;
  });

  it('shows the usage row only when engine is deepgram', async () => {
    const harness = makeFetchMock({});
    global.fetch = harness.fetchMock as unknown as typeof fetch;

    renderWorkspaceHome();

    // engine starts as web-speech → no usage row
    await screen.findByTestId('stt-engine-setting');
    expect(screen.queryByTestId('stt-usage-setting')).toBeNull();
    // /api/stt/usage should not be called while engine is web-speech
    expect(harness.calls.some((c) => c.url.startsWith('/api/stt/usage'))).toBe(false);
  });

  it('renders Used X / Y minutes (engine: deepgram) when deepgram is active', async () => {
    const harness = makeFetchMock({
      settings: { hasDeepgramApiKey: true, sttEngine: 'deepgram', sttMonthlyMinuteCap: 100 },
      usage: { workspaceId: 'ws1', minutesUsedThisMonth: 42, cap: 100, engine: 'deepgram' },
    });
    global.fetch = harness.fetchMock as unknown as typeof fetch;

    renderWorkspaceHome();

    const usage = await screen.findByTestId('stt-usage-setting');
    await waitFor(() => {
      expect(within(usage).getByText(/Used/)).toBeDefined();
      expect(within(usage).getByText('42')).toBeDefined();
      expect(within(usage).getByText('100')).toBeDefined();
      expect(within(usage).getByText(/engine: deepgram/i)).toBeDefined();
    });

    // /api/stt/usage should have been fetched at least once
    expect(harness.calls.some(
      (c) => c.url.startsWith('/api/stt/usage?workspaceId=ws1') && c.method === 'GET',
    )).toBe(true);
  });

  it('renders Used X minutes (no cap) when deepgram is active without a cap', async () => {
    const harness = makeFetchMock({
      settings: { hasDeepgramApiKey: true, sttEngine: 'deepgram', sttMonthlyMinuteCap: null },
      usage: { workspaceId: 'ws1', minutesUsedThisMonth: 7, cap: null, engine: 'deepgram' },
    });
    global.fetch = harness.fetchMock as unknown as typeof fetch;

    renderWorkspaceHome();

    const usage = await screen.findByTestId('stt-usage-setting');
    await waitFor(() => {
      expect(within(usage).getByText(/no cap/i)).toBeDefined();
      expect(within(usage).getByText('7')).toBeDefined();
    });
  });
});
