import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DeviceAuthManager, normalizeUserCode } from './device-auth.js';

describe('DeviceAuthManager', () => {
  let manager: DeviceAuthManager;

  beforeEach(() => {
    manager = new DeviceAuthManager({
      baseUrl: 'https://example.com',
      codeExpirySeconds: 300, // 5 minutes for tests
      pollingIntervalSeconds: 5,
    });
  });

  afterEach(() => {
    manager.shutdown();
  });

  describe('createRequest', () => {
    it('should create a device auth request with valid codes', () => {
      const response = manager.createRequest();

      expect(response.device_code).toBeTruthy();
      expect(response.device_code).toHaveLength(64); // 32 bytes hex
      expect(response.user_code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
      expect(response.verification_uri).toBe('https://example.com/auth/device/verify');
      expect(response.verification_uri_complete).toContain('?code=');
      expect(response.expires_in).toBe(300);
      expect(response.interval).toBe(5);
    });

    it('should create unique codes for each request', () => {
      const response1 = manager.createRequest();
      const response2 = manager.createRequest();

      expect(response1.device_code).not.toBe(response2.device_code);
      expect(response1.user_code).not.toBe(response2.user_code);
    });
  });

  describe('findByUserCode', () => {
    it('should find request by user code', () => {
      const response = manager.createRequest();
      const request = manager.findByUserCode(response.user_code);

      expect(request).not.toBeNull();
      expect(request!.deviceCode).toBe(response.device_code);
      expect(request!.userCode).toBe(response.user_code);
      expect(request!.completed).toBe(false);
    });

    it('should find request with normalized user code (no hyphen)', () => {
      const response = manager.createRequest();
      const codeWithoutHyphen = response.user_code.replace('-', '');
      const request = manager.findByUserCode(codeWithoutHyphen);

      expect(request).not.toBeNull();
    });

    it('should find request with lowercase user code', () => {
      const response = manager.createRequest();
      const lowercaseCode = response.user_code.toLowerCase();
      const request = manager.findByUserCode(lowercaseCode);

      expect(request).not.toBeNull();
    });

    it('should return null for invalid user code', () => {
      const request = manager.findByUserCode('INVALID');
      expect(request).toBeNull();
    });

    it('should return null for expired request', () => {
      vi.useFakeTimers();
      
      const response = manager.createRequest();
      
      // Advance time past expiration
      vi.advanceTimersByTime(301 * 1000); // 301 seconds > 300 expiry
      
      const request = manager.findByUserCode(response.user_code);
      expect(request).toBeNull();
      
      vi.useRealTimers();
    });
  });

  describe('completeRequest', () => {
    it('should mark request as completed with user ID', () => {
      const response = manager.createRequest();
      const userId = 'user-123';

      const result = manager.completeRequest(response.user_code, userId);
      expect(result).toBe(true);

      const request = manager.findByUserCode(response.user_code);
      expect(request!.completed).toBe(true);
      expect(request!.userId).toBe(userId);
      expect(request!.error).toBeNull();
    });

    it('should return false for already completed request', () => {
      const response = manager.createRequest();
      
      manager.completeRequest(response.user_code, 'user-1');
      const result = manager.completeRequest(response.user_code, 'user-2');
      
      expect(result).toBe(false);
    });

    it('should return false for invalid user code', () => {
      const result = manager.completeRequest('INVALID', 'user-123');
      expect(result).toBe(false);
    });
  });

  describe('denyRequest', () => {
    it('should mark request as denied', () => {
      const response = manager.createRequest();

      const result = manager.denyRequest(response.user_code);
      expect(result).toBe(true);

      const request = manager.findByUserCode(response.user_code);
      expect(request!.completed).toBe(true);
      expect(request!.error).toBe('access_denied');
    });

    it('should return false for already completed request', () => {
      const response = manager.createRequest();
      
      manager.completeRequest(response.user_code, 'user-123');
      const result = manager.denyRequest(response.user_code);
      
      expect(result).toBe(false);
    });
  });

  describe('pollForToken', () => {
    it('should return pending status for incomplete request', () => {
      const response = manager.createRequest();
      
      const { request, shouldSlowDown } = manager.pollForToken(response.device_code);
      
      expect(request).not.toBeNull();
      expect(request!.completed).toBe(false);
      expect(shouldSlowDown).toBe(false);
    });

    it('should return completed status with user ID', () => {
      const response = manager.createRequest();
      manager.completeRequest(response.user_code, 'user-123');
      
      const { request } = manager.pollForToken(response.device_code);
      
      expect(request!.completed).toBe(true);
      expect(request!.userId).toBe('user-123');
    });

    it('should return null for invalid device code', () => {
      const { request } = manager.pollForToken('invalid-code');
      expect(request).toBeNull();
    });

    it('should indicate slow down when polling too fast', () => {
      const response = manager.createRequest();
      
      // First poll
      const { shouldSlowDown: first } = manager.pollForToken(response.device_code);
      expect(first).toBe(false);
      
      // Immediate second poll (too fast)
      const { shouldSlowDown: second } = manager.pollForToken(response.device_code);
      expect(second).toBe(true);
    });

    it('should return expired error for expired request', () => {
      vi.useFakeTimers();
      
      const response = manager.createRequest();
      vi.advanceTimersByTime(301 * 1000);
      
      const { request } = manager.pollForToken(response.device_code);
      expect(request!.error).toBe('expired_token');
      
      vi.useRealTimers();
    });
  });

  describe('getRequest', () => {
    it('should return request by device code', () => {
      const response = manager.createRequest();
      const request = manager.getRequest(response.device_code);

      expect(request).not.toBeNull();
      expect(request!.deviceCode).toBe(response.device_code);
    });

    it('should return null for invalid device code', () => {
      const request = manager.getRequest('invalid');
      expect(request).toBeNull();
    });
  });
});

describe('normalizeUserCode', () => {
  it('should convert to uppercase', () => {
    expect(normalizeUserCode('abcd-1234')).toBe('ABCD1234');
  });

  it('should remove hyphens', () => {
    expect(normalizeUserCode('ABCD-1234')).toBe('ABCD1234');
  });

  it('should remove spaces', () => {
    expect(normalizeUserCode('ABCD 1234')).toBe('ABCD1234');
  });

  it('should handle mixed input', () => {
    expect(normalizeUserCode('ab cd-12 34')).toBe('ABCD1234');
  });
});
