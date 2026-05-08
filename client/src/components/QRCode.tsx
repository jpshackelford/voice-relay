import { useEffect, useState, useCallback, useMemo } from 'react';
import QRCode from 'qrcode';
import { useQrToken } from '../hooks/useQrToken';

interface QRCodeDisplayProps {
  /** Size of the QR code in pixels */
  size?: number;
  /** Optional join code to embed in URL */
  joinCode?: string;
  /** Optional workspace ID for deep linking */
  workspaceId?: string;
  /** Optional session ID for session-specific QR codes */
  sessionId?: string;
  /** Whether to show the URL below the QR code */
  showUrl?: boolean;
  /** Custom label above the QR code */
  label?: string;
  /** 
   * Enable signed, time-limited QR tokens for enhanced security.
   * When true, the QR code URL will include a token that expires.
   * Default: true for session URLs, to always include token if available.
   */
  useSignedToken?: boolean;
}

/**
 * Build a URL for QR code based on type of link.
 * Note: For session URLs with requireQrToken, use the getQrUrl from useQrToken instead.
 */
function buildQrUrl(options: {
  joinCode?: string;
  workspaceId?: string;
  sessionId?: string;
}): string {
  const { protocol, hostname, port } = window.location;
  const baseUrl = `${protocol}//${hostname}${port ? ':' + port : ''}`;
  
  // Priority: joinCode > (workspaceId + sessionId) > workspaceId > current URL
  if (options.joinCode) {
    // Join code URL for workspace joining
    return `${baseUrl}/join/${options.joinCode}`;
  }
  
  if (options.workspaceId && options.sessionId) {
    // Deep link to specific session - new direct URL format per F3
    return `${baseUrl}/workspace/${options.workspaceId}/session/${options.sessionId}`;
  }
  
  if (options.workspaceId) {
    // Deep link to workspace
    return `${baseUrl}/workspace/${options.workspaceId}`;
  }
  
  // Fall back to current URL
  return window.location.href.replace(/\/$/, '');
}

function isLocalNetwork(): boolean {
  const hostname = window.location.hostname;
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

export function QRCodeDisplay({ 
  size = 150, 
  joinCode,
  workspaceId,
  sessionId,
  showUrl = true,
  label,
  useSignedToken = true, // Default to true - always try to include tokens for sessions
}: QRCodeDisplayProps) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [isLocalhost, setIsLocalhost] = useState(false);
  const [copied, setCopied] = useState(false);

  // Use signed QR tokens for session URLs when enabled
  // Tokens are generated server-side and auto-refresh before expiration
  const { token, loading: tokenLoading, error: tokenError, getQrUrl, supported } = useQrToken({
    workspaceId,
    sessionId,
    enabled: useSignedToken && !!sessionId && !!workspaceId, // Only for session URLs
  });

  // Determine the URL to encode
  const currentUrl = useMemo((): string => {
    // For session URLs, use the hook's URL builder (includes token if available)
    if (sessionId && workspaceId) {
      return getQrUrl();
    }
    // For non-session URLs (join codes, workspace-only), use standard builder
    return buildQrUrl({ joinCode, workspaceId, sessionId });
  }, [sessionId, workspaceId, joinCode, getQrUrl]);

  // Generate QR code whenever URL changes
  useEffect(() => {
    setIsLocalhost(isLocalNetwork());
    
    QRCode.toDataURL(currentUrl, {
      width: size,
      margin: 2,
      color: {
        dark: '#1a1a2e',
        light: '#ffffff',
      },
    })
      .then(setQrDataUrl)
      .catch(console.error);
  }, [size, currentUrl]);

  const copyToClipboard = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(currentUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, [currentUrl]);

  // Show loading state while fetching initial token
  // Only show if we're expecting a token and haven't loaded yet
  if (useSignedToken && sessionId && tokenLoading && !token && !tokenError) {
    return (
      <div className="qr-code-container">
        {label && <p className="qr-label">{label}</p>}
        <div className="qr-loading" style={{ width: size, height: size, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span>Generating secure QR...</span>
        </div>
      </div>
    );
  }

  // If token generation failed, we still show the QR code (graceful degradation)
  // The server will validate/reject if requireQrToken is enabled

  if (!qrDataUrl) return null;

  // Only expose data-qr-url in non-production for E2E testing
  // In production, users scan the visual QR code with their phones
  const dataQrUrlAttr = import.meta.env.MODE !== 'production' ? { 'data-qr-url': currentUrl } : {};

  return (
    <div className="qr-code-container" {...dataQrUrlAttr}>
      {label && <p className="qr-label">{label}</p>}
      <img src={qrDataUrl} alt="QR Code to connect" width={size} height={size} />
      
      {/* Show token expiration indicator when we have a signed token */}
      {token && supported && (
        <QrTokenExpiry expiresAt={token.expiresAt} />
      )}
      
      {/* Show warning if token was expected but failed */}
      {useSignedToken && sessionId && tokenError && (
        <div className="qr-token-warning" style={{ fontSize: '0.75rem', color: '#f59e0b', marginTop: '0.25rem' }}>
          ⚠️ Token unavailable
        </div>
      )}
      
      {joinCode && (
        <div className="join-code-display">
          <span className="join-code-label">Join Code:</span>
          <span className="join-code">{joinCode}</span>
        </div>
      )}
      
      {showUrl && (
        <div className="qr-url-container">
          <p className="qr-url" onClick={copyToClipboard} title="Click to copy">
            {currentUrl}
          </p>
          {copied && <span className="copied-indicator">✓ Copied!</span>}
        </div>
      )}
      
      {isLocalhost && (
        <p className="qr-hint">
          💡 For mobile access, open this page using your computer's network IP
        </p>
      )}
    </div>
  );
}

/** Shows countdown until QR token expires */
function QrTokenExpiry({ expiresAt }: { expiresAt: string }) {
  const [timeLeft, setTimeLeft] = useState<string>('');

  useEffect(() => {
    const updateTimeLeft = () => {
      const now = Date.now();
      const expiry = new Date(expiresAt).getTime();
      const diff = expiry - now;
      
      if (diff <= 0) {
        setTimeLeft('Refreshing...');
        return;
      }
      
      const minutes = Math.floor(diff / 60000);
      const seconds = Math.floor((diff % 60000) / 1000);
      setTimeLeft(`${minutes}:${seconds.toString().padStart(2, '0')}`);
    };

    updateTimeLeft();
    const interval = setInterval(updateTimeLeft, 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  return (
    <div className="qr-token-expiry" style={{ fontSize: '0.85rem', color: '#666', marginTop: '0.25rem' }}>
      🔒 Valid for {timeLeft}
    </div>
  );
}

/**
 * Compact join code input for workspace entry.
 */
interface JoinCodeInputProps {
  onJoin: (code: string) => void;
  loading?: boolean;
  error?: string;
}

export function JoinCodeInput({ onJoin, loading, error }: JoinCodeInputProps) {
  const [code, setCode] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedCode = code.trim().toUpperCase();
    if (trimmedCode) {
      onJoin(trimmedCode);
    }
  };

  return (
    <form className="join-code-input" onSubmit={handleSubmit}>
      <input
        type="text"
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
        placeholder="Enter join code"
        maxLength={8}
        disabled={loading}
        className="join-code-field"
        aria-label="Join code"
      />
      <button type="submit" disabled={loading || !code.trim()} className="join-code-button">
        {loading ? 'Joining...' : 'Join'}
      </button>
      {error && <p className="join-code-error">{error}</p>}
    </form>
  );
}
