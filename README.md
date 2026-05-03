# Voice Relay

Real-time text and speech relay between browser devices. Connect multiple browsers as input or output devices to relay text via WebSocket, with speech-to-text (STT) and text-to-speech (TTS) support.

## Features

- **Input devices**: Type text or use speech-to-text to send messages
- **Output devices**: Display received messages with optional text-to-speech
- **Real-time streaming**: See text as it's being typed (partial messages)
- **Device registry**: See all connected devices
- **Per-tab identity**: Each browser tab is a unique device

## Local Development

### Prerequisites

- Node.js 20+
- npm

### Quick Start

```bash
# Install dependencies
npm install

# Start both server and client in dev mode
npm run dev
```

This starts:
- Server on http://localhost:3001 (WebSocket at ws://localhost:3001/ws)
- Client on http://localhost:5173 (proxies /ws to server)

Open http://localhost:5173 in multiple browser tabs to test!

### Network Access (Multiple Devices)

The dev server listens on all interfaces, so you can access it from other devices on your local network:

```bash
# From your Mac, find your hostname
hostname  # e.g., my-macbook.local

# Other devices on the network can access via mDNS:
http://my-macbook.local:5173
```

The setup page includes a QR code for easy mobile access - click "Connect another device" to reveal it.

**Note:** Speech-to-text requires a secure context (HTTPS or localhost). On non-localhost URLs, STT may not work in Chrome. Safari is more permissive for local network access.

### Development Scripts

```bash
# Run just the server
npm run dev -w server

# Run just the client
npm run dev -w client

# Build for production
npm run build

# Start production server (after build)
npm start
```

## Storage Backends

Message history can be persisted using different storage backends. Configure via environment variables:

### Memory (Default)

In-memory ring buffer. Fast but lost on restart.

```bash
STORE_DRIVER=memory
STORE_MAX_MESSAGES=100  # optional, default 100
```

### SQLite

File-based persistence. Great for local development.

```bash
STORE_DRIVER=sqlite
SQLITE_PATH=./data/messages.db
```

### Redis

Shared state for multi-instance deployments.

```bash
STORE_DRIVER=redis
REDIS_URL=redis://localhost:6379
STORE_MAX_MESSAGES=100
```

### Firestore (Stub)

For GCP production deployments. Implementation stubbed - uncomment code in `server/src/storage/firestore.ts` and install `@google-cloud/firestore`.

```bash
STORE_DRIVER=firestore
FIRESTORE_PROJECT_ID=your-project
FIRESTORE_COLLECTION=voice-relay-messages
```

## AI Assistant Integration

Voice Relay can connect to OpenHands AI for interactive conversations. When enabled, a sparkle button (✨) appears in chat and kiosk modes.

### Setup

1. Get an API key from [OpenHands Cloud](https://app.all-hands.dev)

2. Set the environment variable:

```bash
# Local development
export OPENHANDS_CLOUD_API_KEY=your-api-key-here

# Or in .env file (not committed)
OPENHANDS_CLOUD_API_KEY=your-api-key-here
```

3. For systemd deployments, add to your service file:

```ini
[Service]
Environment="OPENHANDS_CLOUD_API_KEY=your-api-key-here"
```

Or use an environment file:

```ini
[Service]
EnvironmentFile=/etc/voice-relay/env
```

### Usage

1. Click the ✨ button to connect to AI
2. The button glows purple when connected
3. Speak or type messages - AI responses appear in chat
4. In kiosk mode, AI can display content on the main display area
5. Click ✨ again to disconnect

### API Endpoints

```bash
# Check AI availability
GET /api/ai/status

# Connect AI to a device
POST /api/ai/connect
{ "deviceId": "...", "mode": "chat" | "kiosk" }

# Send message to AI
POST /api/ai/message
{ "deviceId": "...", "message": "..." }

# Disconnect AI
DELETE /api/ai/disconnect
{ "deviceId": "..." }
```

## Deploy to Cloud Run

### Prerequisites

- [Google Cloud SDK](https://cloud.google.com/sdk/docs/install) installed
- A GCP project with billing enabled

### Deploy

```bash
# Authenticate (if not already)
gcloud auth login

# Set your project
gcloud config set project YOUR_PROJECT_ID

# Deploy (builds and deploys in one command)
gcloud run deploy voice-relay \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --min-instances 1 \
  --max-instances 1

# Get the URL
gcloud run services describe voice-relay --format='value(status.url)'
```

### Scaling Considerations

With `max-instances=1`, all devices share the same in-memory registry. For multiple instances, you'd need external state (Redis, Firestore) for cross-instance communication.

## Architecture

```
┌─────────────────┐          ┌─────────────────┐
│  Input Device   │          │  Output Device  │
│  - Text input   │          │  - Display      │
│  - STT button   │          │  - TTS toggle   │
└────────┬────────┘          └────────┬────────┘
         │                            │
         │      WebSocket (/ws)       │
         └──────────┬─────────────────┘
                    │
         ┌──────────▼──────────┐
         │       Server        │
         │  - Device Registry  │
         │  - Message Relay    │
         └─────────────────────┘
```

## Message Protocol

### Client → Server

```typescript
// Register device
{ type: 'register', deviceId: string, displayName: string, mode: 'input' | 'output' }

// Update device settings
{ type: 'update-device', displayName?: string, mode?: 'input' | 'output', ttsEnabled?: boolean }

// Send text (input devices only)
{ type: 'text', utteranceId: string, text: string, partial: boolean }
```

### Server → Client

```typescript
// Registration confirmed
{ type: 'registered', deviceId: string }

// Device list update
{ type: 'device-list', devices: [{ id, displayName, mode }] }

// Relayed text (output devices)
{ type: 'text', utteranceId: string, senderId: string, senderName: string, text: string, partial: boolean }
```

## Browser Support

- **STT**: Chrome, Edge (Web Speech API)
- **TTS**: All modern browsers
- **WebSocket**: All modern browsers

## Testing

End-to-end tests use Playwright to simulate multiple browser devices:

```bash
# Run all tests (headless)
npm test

# Run tests with browser visible
npm run test:headed

# Run tests with Playwright UI
npm run test:ui
```

### Test Coverage

- Device setup and connection
- Input/output mode switching
- Real-time text relay between browsers
- Partial message (typing) indicators
- Message history for late-joining devices
- Device count updates

## License

MIT
