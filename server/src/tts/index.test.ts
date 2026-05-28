import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TtsService, DEFAULT_VOICE_ID } from './index.js';
import type { WorkspaceSettings } from '../workspaces/types.js';
import type { DeviceRegistry } from '../registry.js';

describe('TtsService', () => {
  const mockSettings: WorkspaceSettings = {
    workspaceId: 'workspace-1',
    openhandsApiKeyEncrypted: null,
    openhandsApiKeyIv: null,
    openhandsApiKeyTag: null,
    ttsVoice: null,
    sttLanguage: null,
    allowAutoJoin: false,
    requireQrToken: false,
    elevenlabsApiKeyEncrypted: 'encrypted-key',
    elevenlabsApiKeyIv: 'iv',
    elevenlabsApiKeyTag: 'tag',
    elevenlabsVoiceId: 'voice-123',
    elevenlabsTtsEnabled: true,
    kioskFooterTickersEnabled: false,
    updatedAt: null,
  };

  const mockRegistry = {
    broadcastAudioToKiosks: vi.fn(),
    getDevicesBySession: vi.fn().mockReturnValue([]),
  } as unknown as DeviceRegistry;

  const mockGetWorkspaceSettings = vi.fn();
  const mockDecryptApiKey = vi.fn().mockReturnValue('decrypted-key');

  let service: TtsService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new TtsService({
      registry: mockRegistry,
      getWorkspaceSettings: mockGetWorkspaceSettings,
      decryptApiKey: mockDecryptApiKey,
    });
  });

  describe('isEnabled', () => {
    it('returns false when no settings exist', () => {
      mockGetWorkspaceSettings.mockReturnValue(null);
      expect(service.isEnabled('workspace-1')).toBe(false);
    });

    it('returns false when TTS is disabled', () => {
      mockGetWorkspaceSettings.mockReturnValue({
        ...mockSettings,
        elevenlabsTtsEnabled: false,
      });
      expect(service.isEnabled('workspace-1')).toBe(false);
    });

    it('returns false when no API key is configured', () => {
      mockGetWorkspaceSettings.mockReturnValue({
        ...mockSettings,
        elevenlabsApiKeyEncrypted: null,
        elevenlabsApiKeyIv: null,
        elevenlabsApiKeyTag: null,
      });
      expect(service.isEnabled('workspace-1')).toBe(false);
    });

    it('returns true when TTS is enabled and API key is configured', () => {
      mockGetWorkspaceSettings.mockReturnValue(mockSettings);
      expect(service.isEnabled('workspace-1')).toBe(true);
    });
  });

  describe('synthesizeForSession', () => {
    it('does nothing when settings are not found', async () => {
      mockGetWorkspaceSettings.mockReturnValue(null);

      // Even with session TTS enabled, missing workspace settings should prevent TTS
      await service.synthesizeForSession('hello', 'workspace-1', 'session-1', 'utt-1', { enabled: true, outputDeviceId: null });

      expect(mockDecryptApiKey).not.toHaveBeenCalled();
      expect(mockRegistry.broadcastAudioToKiosks).not.toHaveBeenCalled();
    });

    it('does nothing when TTS is not enabled at workspace level', async () => {
      mockGetWorkspaceSettings.mockReturnValue({
        ...mockSettings,
        elevenlabsTtsEnabled: false,
      });

      // Even with session TTS enabled, disabled workspace TTS should prevent synthesis
      await service.synthesizeForSession('hello', 'workspace-1', 'session-1', 'utt-1', { enabled: true, outputDeviceId: null });

      expect(mockDecryptApiKey).not.toHaveBeenCalled();
      expect(mockRegistry.broadcastAudioToKiosks).not.toHaveBeenCalled();
    });

    it('decrypts API key when TTS is enabled', async () => {
      mockGetWorkspaceSettings.mockReturnValue(mockSettings);
      // Mock synthesize to prevent actual WebSocket connection
      vi.mock('./elevenlabs.js', () => ({
        synthesize: vi.fn().mockRejectedValue(new Error('Mock error')),
        DEFAULT_VOICE_ID: 'Xb7hH8MSUJpSbSDYk0k2',
      }));

      // Must pass sessionTtsSettings with enabled: true (defaults to disabled if undefined)
      await service.synthesizeForSession('hello', 'workspace-1', 'session-1', 'utt-1', { enabled: true, outputDeviceId: null });

      expect(mockDecryptApiKey).toHaveBeenCalledWith({
        encrypted: 'encrypted-key',
        iv: 'iv',
        tag: 'tag',
      });
    });

    it('does nothing when sessionTtsSettings is undefined (defaults to disabled)', async () => {
      mockGetWorkspaceSettings.mockReturnValue(mockSettings);

      await service.synthesizeForSession('hello', 'workspace-1', 'session-1', 'utt-1');

      expect(mockDecryptApiKey).not.toHaveBeenCalled();
      expect(mockRegistry.broadcastAudioToKiosks).not.toHaveBeenCalled();
    });

    it('does nothing when sessionTtsSettings.enabled is false', async () => {
      mockGetWorkspaceSettings.mockReturnValue(mockSettings);

      await service.synthesizeForSession('hello', 'workspace-1', 'session-1', 'utt-1', { enabled: false, outputDeviceId: null });

      expect(mockDecryptApiKey).not.toHaveBeenCalled();
      expect(mockRegistry.broadcastAudioToKiosks).not.toHaveBeenCalled();
    });
  });

  describe('DEFAULT_VOICE_ID', () => {
    it('exports the default voice ID', () => {
      expect(DEFAULT_VOICE_ID).toBe('Xb7hH8MSUJpSbSDYk0k2');
    });
  });
});
