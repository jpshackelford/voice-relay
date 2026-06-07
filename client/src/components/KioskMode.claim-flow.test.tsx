/**
 * Integration smoke test for the first-run claim-card flow at the
 * KioskMode page-layer (issue #440, follow-up to #433 / PR #438).
 *
 * Why KioskMode-level, not SessionView-level:
 *   The card's show/hide derivation (`shouldShowClaimCard` in
 *   KioskMode.tsx) is the only thing standing between a healthy claim
 *   flow and a regression where the card flickers, never shows, or
 *   re-appears after a claim. SessionView merely threads `speakerState`
 *   and `login` into KioskMode props — that wiring is already covered
 *   by `useWebSocket.test.ts`. Mounting SessionView here would re-test
 *   already-tested wiring at the cost of ~150 lines of scaffolding.
 *
 * Mocks mirror the established pattern in `KioskMode.test.tsx`:
 * `useSpeechRecognition`, `QRCode`, and `Oscilloscope` are stubbed; no
 * new package deps.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { KioskMode } from './KioskMode';
import { SKIP_TTL_MS, skipKey } from './ClaimSpeakerCard';
import { storeDeviceToken } from '../utils/deviceToken';
import type {
  DeviceInfo,
  Utterance,
  DisplayContent,
  SessionTtsSettings,
  SpeakerState,
} from '../types';

// ---- Mocks: identical to KioskMode.test.tsx ----------------------------
vi.mock('../hooks/useSpeechRecognition', () => ({
  useSpeechRecognition: () => ({
    isListening: false,
    isSupported: true,
    startListening: vi.fn(),
    stopListening: vi.fn(),
  }),
}));

vi.mock('./QRCode', () => ({
  QRCodeDisplay: ({ size }: { size?: number }) => (
    <div data-testid="qr-code" data-size={size}>QR Code</div>
  ),
}));

vi.mock('./Oscilloscope', () => ({
  Oscilloscope: ({ color }: { color?: string }) => (
    <div data-testid="oscilloscope-mock" data-color={color} />
  ),
}));

// ---- Fixtures ----------------------------------------------------------
const WORKSPACE_ID = 'ws-1';
const DEVICE_ID = 'dev-1';
const SESSION_ID = 'test-session';
const DEVICE_TOKEN = 'tok-abc';

const unclaimedSpeakerState: SpeakerState = {
  deviceClaimed: false,
  primaryUserId: null,
  activeSpeakerId: null,
};

// AI state mirrors KioskMode.test.tsx — only the shape matters for this
// test; nothing here exercises the AI restart path.
const mockAiState = {
  connected: false,
  connecting: false,
  thinking: false,
  degraded: false,
  restarting: false,
  restartError: null,
  conversationId: null,
  error: null,
  restart: vi.fn().mockResolvedValue({
    ok: true,
    status: {
      sessionId: SESSION_ID,
      state: 'starting' as const,
      conversationId: null,
      error: null,
      thinkingSince: null,
      startingSince: null,
    },
  }),
};

function makeProps(
  overrides: Partial<React.ComponentProps<typeof KioskMode>> = {}
): React.ComponentProps<typeof KioskMode> {
  return {
    deviceId: DEVICE_ID,
    displayName: 'Test Kiosk',
    connected: true,
    devices: [] as DeviceInfo[],
    utterances: new Map<string, Utterance>(),
    displayContent: null as DisplayContent | null,
    sendText: vi.fn(),
    onModeChange: vi.fn(),
    onAIStatusChange: vi.fn(),
    onExit: vi.fn(),
    workspaceId: WORKSPACE_ID,
    sessionId: SESSION_ID,
    ai: mockAiState,
    sessionTtsSettings: { enabled: false, outputDeviceId: null } as SessionTtsSettings,
    onSessionTtsSettingsChange: vi.fn(),
    speakerState: unclaimedSpeakerState,
    onSpeakerSignIn: vi.fn(),
    ...overrides,
  };
}

// ---- Suite -------------------------------------------------------------
describe('KioskMode — first-run claim card integration', () => {
  beforeEach(() => {
    localStorage.clear();
    // KioskMode reads the device token via `getStoredDeviceToken(workspaceId)`
    // and only renders the card when one is present. Use the real helper
    // so the test stays in sync with key-naming changes.
    storeDeviceToken({
      deviceId: DEVICE_ID,
      deviceToken: DEVICE_TOKEN,
      workspaceId: WORKSPACE_ID,
      name: 'Kiosk One',
      mode: 'kiosk',
    });
    // Default fetch mock throws so accidental network reaches blow up
    // loudly. Tests that need a successful POST override per-call.
    vi.spyOn(global, 'fetch').mockImplementation(() => {
      throw new Error('unhandled fetch in test');
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('AC#1: "I\'m a workspace member" routes to OAuth without touching the network', async () => {
    const onSpeakerSignIn = vi.fn();
    const fetchMock = vi.mocked(fetch);

    await act(async () => {
      render(<KioskMode {...makeProps({ onSpeakerSignIn })} />);
    });

    // Card must be on-screen so the click is meaningful.
    expect(screen.getByTestId('claim-speaker-card')).toBeDefined();

    fireEvent.click(
      screen.getByRole('button', { name: /workspace member/i })
    );

    // The button wires `onClick={onSignIn}` directly, so the handler
    // receives the synthetic click event. We assert only call count —
    // the contract is "delegated to the parent", not the arg shape.
    expect(onSpeakerSignIn).toHaveBeenCalledTimes(1);
    // OAuth is delegated to the parent — no fetch should fire from
    // inside the card on this path.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('AC#2: name-only flow POSTs to the device-token endpoint and hides the card on success', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ speakerId: 'sp-1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await act(async () => {
      render(<KioskMode {...makeProps()} />);
    });

    fireEvent.click(
      screen.getByRole('button', { name: /remember a name/i })
    );
    fireEvent.change(screen.getByPlaceholderText(/e\.g\. JP/i), {
      target: { value: 'JP' },
    });
    fireEvent.change(screen.getByPlaceholderText(/she\/her/i), {
      target: { value: 'they/them' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    // The card hides once the optimistic `claimedLocally` flag flips.
    await waitFor(() =>
      expect(screen.queryByTestId('claim-speaker-card')).toBeNull()
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      `/api/devices/${DEVICE_ID}/sessions/${SESSION_ID}/active-speaker`
    );
    expect(init?.method).toBe('POST');
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${DEVICE_TOKEN}`);
    expect(headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init!.body as string)).toEqual({
      preferredName: 'JP',
      pronouns: 'they/them',
    });
  });

  it('AC#3: "Skip — shared device" writes a ~7-day TTL and hides the card', async () => {
    await act(async () => {
      render(<KioskMode {...makeProps()} />);
    });

    const before = Date.now();
    fireEvent.click(
      screen.getByRole('button', { name: /shared device/i })
    );

    // Card disappears on the next render after `setLongSkipped(true)`.
    await waitFor(() =>
      expect(screen.queryByTestId('claim-speaker-card')).toBeNull()
    );

    const raw = localStorage.getItem(skipKey(WORKSPACE_ID, DEVICE_ID));
    expect(raw).not.toBeNull();
    const writtenAt = Date.parse(raw!);
    // ClaimSpeakerCard records `now + SKIP_TTL_MS`. Allow a generous
    // ±5s window for slow CI.
    const expected = before + SKIP_TTL_MS;
    expect(writtenAt).toBeGreaterThanOrEqual(expected - 5_000);
    expect(writtenAt).toBeLessThanOrEqual(Date.now() + SKIP_TTL_MS);
  });

  it('AC#4a: re-render after a successful claim does NOT re-show the card', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ speakerId: 'sp-1' }), { status: 200 })
    );

    const props = makeProps();
    const { rerender } = render(<KioskMode {...props} />);

    fireEvent.click(
      screen.getByRole('button', { name: /remember a name/i })
    );
    fireEvent.change(screen.getByPlaceholderText(/e\.g\. JP/i), {
      target: { value: 'JP' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() =>
      expect(screen.queryByTestId('claim-speaker-card')).toBeNull()
    );

    // Server hasn't echoed `deviceClaimed=true` yet — re-render with the
    // same unclaimed speakerState and assert the optimistic local claim
    // wins (`claimedLocally` stays true across re-renders within the
    // same session).
    rerender(
      <KioskMode {...props} speakerState={unclaimedSpeakerState} />
    );
    expect(screen.queryByTestId('claim-speaker-card')).toBeNull();
  });

  it('AC#4b: re-mount after a 7-day skip keeps the card hidden via localStorage', async () => {
    const first = render(<KioskMode {...makeProps()} />);

    fireEvent.click(
      screen.getByRole('button', { name: /shared device/i })
    );
    await waitFor(() =>
      expect(screen.queryByTestId('claim-speaker-card')).toBeNull()
    );

    // `longSkipped` is initialised inside an effect from `getSkipUntil`,
    // so a fresh mount must re-read localStorage. Unmount + remount
    // verifies the TTL persists the suppression beyond component
    // lifecycle — not just the in-memory flag.
    first.unmount();
    render(<KioskMode {...makeProps()} />);

    expect(screen.queryByTestId('claim-speaker-card')).toBeNull();
  });

  it('AC#5: × close button hides the card without writing the 7-day TTL', async () => {
    await act(async () => {
      render(<KioskMode {...makeProps()} />);
    });

    fireEvent.click(screen.getByRole('button', { name: /close/i }));

    await waitFor(() =>
      expect(screen.queryByTestId('claim-speaker-card')).toBeNull()
    );

    expect(
      localStorage.getItem(skipKey(WORKSPACE_ID, DEVICE_ID))
    ).toBeNull();
  });
});
