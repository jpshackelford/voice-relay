import { useState, useCallback, useEffect } from 'react';
import { DeviceSetup } from './components/DeviceSetup';
import { MobileMode } from './components/MobileMode';
import { KioskMode } from './components/KioskMode';
import { useWebSocket } from './hooks/useWebSocket';
import { generateUUID } from './utils/uuid';
import { generateDefaultDeviceName } from './utils/deviceName';
import type { DeviceMode, Utterance, ServerMessage, DisplayContent } from './types';
import './App.css';

function getOrCreateDeviceId(): string {
  let id = sessionStorage.getItem('deviceId');
  if (!id) {
    id = generateUUID();
    sessionStorage.setItem('deviceId', id);
  }
  return id;
}

function getOrCreateDisplayName(): string {
  let name = sessionStorage.getItem('displayName');
  if (!name) {
    name = generateDefaultDeviceName();
    sessionStorage.setItem('displayName', name);
  }
  return name;
}

export default function App() {
  const [deviceId] = useState(getOrCreateDeviceId);
  const [displayName, setDisplayName] = useState(getOrCreateDisplayName);
  const [mode, setMode] = useState<DeviceMode | null>(null);
  const [utterances, setUtterances] = useState<Map<string, Utterance>>(new Map());
  const [displayContent, setDisplayContent] = useState<DisplayContent | null>(null);

  const handleTextMessage = useCallback((message: ServerMessage & { type: 'text' }) => {
    setUtterances(prev => {
      const next = new Map(prev);
      next.set(message.utteranceId, {
        id: message.utteranceId,
        senderId: message.senderId,
        senderName: message.senderName,
        text: message.text,
        partial: message.partial,
        receivedAt: prev.get(message.utteranceId)?.receivedAt || new Date(),
      });
      return next;
    });
  }, []);

  const handleHistoryMessage = useCallback((message: ServerMessage & { type: 'history' }) => {
    setUtterances(prev => {
      const next = new Map(prev);
      for (const msg of message.messages) {
        // Don't overwrite existing messages (history is older)
        if (!next.has(msg.utteranceId)) {
          next.set(msg.utteranceId, {
            id: msg.utteranceId,
            senderId: msg.senderId,
            senderName: msg.senderName,
            text: msg.text,
            partial: msg.partial,
            receivedAt: new Date(), // We don't have exact time, use now
          });
        }
      }
      return next;
    });
  }, []);

  const handleDisplayMessage = useCallback((message: ServerMessage & { type: 'display' }) => {
    if (message.display.type === 'clear') {
      setDisplayContent(null);
    } else {
      setDisplayContent(message.display);
    }
  }, []);

  const { connected, devices, sendText, updateDevice } = useWebSocket({
    deviceId,
    displayName: displayName || 'Unknown Device',
    mode: mode || 'mobile',
    onTextMessage: handleTextMessage,
    onHistoryMessage: handleHistoryMessage,
    onDisplayMessage: handleDisplayMessage,
  });

  // Store display name in session
  useEffect(() => {
    if (displayName) {
      sessionStorage.setItem('displayName', displayName);
    }
  }, [displayName]);

  const handleSetup = (name: string, selectedMode: DeviceMode) => {
    setDisplayName(name);
    setMode(selectedMode);
  };

  const handleModeChange = (newMode: DeviceMode) => {
    setMode(newMode);
    updateDevice({ mode: newMode });
  };

  // Show setup if not configured
  if (!mode) {
    return <DeviceSetup initialName={displayName} onSubmit={handleSetup} />;
  }

  // Validate mode (TypeScript ensures this at compile time, but this catches
  // any runtime issues from WebSocket messages or corrupted session storage)
  if (mode !== 'mobile' && mode !== 'kiosk') {
    throw new Error(`Invalid device mode: "${mode}". Valid modes are 'mobile' or 'kiosk'.`);
  }

  // Kiosk mode - large display with sidebar
  if (mode === 'kiosk') {
    return (
      <KioskMode
        deviceId={deviceId}
        displayName={displayName}
        connected={connected}
        devices={devices}
        utterances={utterances}
        displayContent={displayContent}
        sendText={sendText}
        onModeChange={handleModeChange}
      />
    );
  }

  // Mobile mode (default) - conversation focused
  return (
    <MobileMode
      deviceId={deviceId}
      displayName={displayName}
      connected={connected}
      devices={devices}
      utterances={utterances}
      sendText={sendText}
      onModeChange={handleModeChange}
    />
  );
}
