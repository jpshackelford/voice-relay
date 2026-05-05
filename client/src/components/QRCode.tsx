import { useEffect, useState, useCallback } from 'react';
import QRCode from 'qrcode';

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
}

/**
 * Build a URL for QR code based on type of link.
 */
function buildQrUrl(options: {
  joinCode?: string;
  workspaceId?: string;
  sessionId?: string;
}): string {
  const { protocol, hostname, port } = window.location;
  const baseUrl = `${protocol}//${hostname}${port ? ':' + port : ''}`;
  
  // Priority: joinCode > sessionId > workspaceId > current URL
  if (options.joinCode) {
    // Join code URL for workspace joining
    return `${baseUrl}/join/${options.joinCode}`;
  }
  
  if (options.workspaceId && options.sessionId) {
    // Deep link to specific session
    return `${baseUrl}/workspace/${options.workspaceId}?session=${options.sessionId}`;
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
}: QRCodeDisplayProps) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [currentUrl, setCurrentUrl] = useState<string>('');
  const [isLocalhost, setIsLocalhost] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const url = buildQrUrl({ joinCode, workspaceId, sessionId });
    setCurrentUrl(url);
    setIsLocalhost(isLocalNetwork());
    
    QRCode.toDataURL(url, {
      width: size,
      margin: 2,
      color: {
        dark: '#1a1a2e',
        light: '#ffffff',
      },
    })
      .then(setQrDataUrl)
      .catch(console.error);
  }, [size, joinCode, workspaceId, sessionId]);

  const copyToClipboard = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(currentUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, [currentUrl]);

  if (!qrDataUrl) return null;

  return (
    <div className="qr-code-container">
      {label && <p className="qr-label">{label}</p>}
      <img src={qrDataUrl} alt="QR Code to connect" width={size} height={size} />
      
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
