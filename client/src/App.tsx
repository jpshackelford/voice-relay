import { useState, useCallback, useEffect } from 'react';
import { DeviceSetup } from './components/DeviceSetup';
import { InputMode } from './components/InputMode';
import { OutputMode } from './components/OutputMode';
import { ChatMode } from './components/ChatMode';
import { useWebSocket } from './hooks/useWebSocket';
import { generateUUID } from './utils/uuid';
import type { DeviceMode, Utterance, ServerMessage } from './types';
import './App.css';

function getOrCreateDeviceId(): string {
  let id = sessionStorage.getItem('deviceId');
  if (!id) {
    id = generateUUID();
    sessionStorage.setItem('deviceId', id);
  }
  return id;
}

function getStoredDisplayName(): string {
  return sessionStorage.getItem('displayName') || '';
}

export default function App() {
  const [deviceId] = useState(getOrCreateDeviceId);
  const [displayName, setDisplayName] = useState(getStoredDisplayName);
  const [mode, setMode] = useState<DeviceMode | null>(null);
  const [utterances, setUtterances] = useState<Map<string, Utterance>>(new Map());

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

  const { connected, devices, sendText, updateDevice } = useWebSocket({
    deviceId,
    displayName: displayName || 'Unknown Device',
    mode: mode || 'output',
    onTextMessage: handleTextMessage,
    onHistoryMessage: handleHistoryMessage,
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

  if (mode === 'input') {
    return (
      <InputMode
        displayName={displayName}
        connected={connected}
        devices={devices}
        sendText={sendText}
        onModeChange={handleModeChange}
      />
    );
  }

  if (mode === 'chat') {
    return (
      <ChatMode
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

  return (
    <OutputMode
      displayName={displayName}
      connected={connected}
      devices={devices}
      utterances={utterances}
      onModeChange={handleModeChange}
    />
  );
}
