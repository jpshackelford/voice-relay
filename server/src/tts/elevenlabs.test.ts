import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { testApiKey, DEFAULT_VOICE_ID } from './elevenlabs.js';

describe('ElevenLabs TTS', () => {
  describe('testApiKey', () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
      // Reset fetch mock before each test
      global.fetch = vi.fn();
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('returns valid for successful API response', async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        status: 200,
      } as Response);

      const result = await testApiKey('valid-api-key');
      expect(result.valid).toBe(true);
      expect(result.message).toBe('API key is valid');
    });

    it('returns invalid for 401 unauthorized', async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: false,
        status: 401,
      } as Response);

      const result = await testApiKey('invalid-api-key');
      expect(result.valid).toBe(false);
      expect(result.message).toBe('Invalid API key');
    });

    it('returns invalid for other error status', async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: false,
        status: 500,
      } as Response);

      const result = await testApiKey('some-key');
      expect(result.valid).toBe(false);
      expect(result.message).toBe('API error: 500');
    });

    it('returns connection error for network failure', async () => {
      vi.mocked(global.fetch).mockRejectedValue(new Error('Network error'));

      const result = await testApiKey('some-key');
      expect(result.valid).toBe(false);
      expect(result.message).toBe('Connection error: Network error');
    });

    it('sends correct headers to ElevenLabs API', async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        status: 200,
      } as Response);

      await testApiKey('test-key-123');

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.elevenlabs.io/v1/voices',
        {
          headers: {
            'xi-api-key': 'test-key-123',
          },
        }
      );
    });
  });

  describe('DEFAULT_VOICE_ID', () => {
    it('exports the Aria voice ID', () => {
      expect(DEFAULT_VOICE_ID).toBe('Xb7hH8MSUJpSbSDYk0k2');
    });
  });
});
