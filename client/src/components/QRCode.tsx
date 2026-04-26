import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

interface QRCodeDisplayProps {
  size?: number;
}

function getNetworkUrl(): string {
  const { protocol, hostname, port, pathname } = window.location;
  
  // If already on a network IP (not localhost), use it
  if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
    return `${protocol}//${hostname}${port ? ':' + port : ''}${pathname}`.replace(/\/$/, '');
  }
  
  // Otherwise, return localhost URL (user needs to share network URL manually)
  return `${protocol}//${hostname}${port ? ':' + port : ''}${pathname}`.replace(/\/$/, '');
}

export function QRCodeDisplay({ size = 150 }: QRCodeDisplayProps) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [currentUrl, setCurrentUrl] = useState<string>('');
  const [isLocalhost, setIsLocalhost] = useState(false);

  useEffect(() => {
    const url = getNetworkUrl();
    const hostname = window.location.hostname;
    setCurrentUrl(url);
    setIsLocalhost(hostname === 'localhost' || hostname === '127.0.0.1');
    
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
  }, [size]);

  if (!qrDataUrl) return null;

  return (
    <div className="qr-code-container">
      <img src={qrDataUrl} alt="QR Code to connect" width={size} height={size} />
      <p className="qr-url">{currentUrl}</p>
      {isLocalhost && (
        <p className="qr-hint">
          💡 For mobile access, open this page using your computer's network IP
        </p>
      )}
    </div>
  );
}
