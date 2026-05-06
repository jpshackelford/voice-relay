import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Extract buildQrUrl function for testing
function buildQrUrl(options: {
  joinCode?: string;
  workspaceId?: string;
  sessionId?: string;
}): string {
  // For testing, we'll mock window.location
  const { protocol, hostname, port } = window.location;
  const baseUrl = `${protocol}//${hostname}${port ? ':' + port : ''}`;
  
  if (options.joinCode) {
    return `${baseUrl}/join/${options.joinCode}`;
  }
  
  if (options.workspaceId && options.sessionId) {
    return `${baseUrl}/workspace/${options.workspaceId}/session/${options.sessionId}`;
  }
  
  if (options.workspaceId) {
    return `${baseUrl}/workspace/${options.workspaceId}`;
  }
  
  return window.location.href.replace(/\/$/, '');
}

describe('QRCode buildQrUrl', () => {
  let originalLocation: Location;

  beforeEach(() => {
    // Save original location
    originalLocation = window.location;
    
    // Mock window.location
    Object.defineProperty(window, 'location', {
      writable: true,
      value: {
        protocol: 'https:',
        hostname: 'vr.chorecraft.net',
        port: '',
        href: 'https://vr.chorecraft.net/workspace/ws123',
      },
    });
  });

  afterEach(() => {
    // Restore original location
    Object.defineProperty(window, 'location', {
      writable: true,
      value: originalLocation,
    });
  });

  describe('URL generation priority', () => {
    it('prioritizes joinCode over other options', () => {
      const url = buildQrUrl({
        joinCode: 'ABC123',
        workspaceId: 'ws123',
        sessionId: 'sess456',
      });

      expect(url).toBe('https://vr.chorecraft.net/join/ABC123');
    });

    it('generates session URL when both workspaceId and sessionId provided', () => {
      const url = buildQrUrl({
        workspaceId: 'ws123',
        sessionId: 'sess456',
      });

      expect(url).toBe('https://vr.chorecraft.net/workspace/ws123/session/sess456');
    });

    it('generates workspace URL when only workspaceId provided', () => {
      const url = buildQrUrl({
        workspaceId: 'ws123',
      });

      expect(url).toBe('https://vr.chorecraft.net/workspace/ws123');
    });

    it('falls back to current URL when no options provided', () => {
      const url = buildQrUrl({});

      expect(url).toBe('https://vr.chorecraft.net/workspace/ws123');
    });
  });

  describe('URL formatting', () => {
    it('handles localhost with port', () => {
      Object.defineProperty(window, 'location', {
        writable: true,
        value: {
          protocol: 'http:',
          hostname: 'localhost',
          port: '3000',
          href: 'http://localhost:3000/',
        },
      });

      const url = buildQrUrl({
        workspaceId: 'ws123',
        sessionId: 'sess456',
      });

      expect(url).toBe('http://localhost:3000/workspace/ws123/session/sess456');
    });

    it('strips trailing slash from fallback URL', () => {
      Object.defineProperty(window, 'location', {
        writable: true,
        value: {
          protocol: 'https:',
          hostname: 'vr.chorecraft.net',
          port: '',
          href: 'https://vr.chorecraft.net/workspace/ws123/',
        },
      });

      const url = buildQrUrl({});

      expect(url).toBe('https://vr.chorecraft.net/workspace/ws123');
    });
  });
});

describe('Session URL format for F3', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'location', {
      writable: true,
      value: {
        protocol: 'https:',
        hostname: 'vr.chorecraft.net',
        port: '',
        href: 'https://vr.chorecraft.net/',
      },
    });
  });

  it('uses new URL format /workspace/:wid/session/:sid', () => {
    const url = buildQrUrl({
      workspaceId: 'abc-def-123',
      sessionId: 'session-xyz-789',
    });

    // Should use new path format, not query param
    expect(url).toBe('https://vr.chorecraft.net/workspace/abc-def-123/session/session-xyz-789');
    expect(url).not.toContain('?session=');
  });
});
