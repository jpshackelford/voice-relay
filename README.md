# Voice Relay

A multi-user real-time communication platform that connects devices (kiosks and mobile phones) for voice/text relay and AI assistant integration. Built with workspaces for user isolation and sessions for conversation management.

## Features

- **Multi-user workspaces**: GitHub OAuth authentication with isolated environments per user
- **Device views**: Kiosk (large display + sidebar) and Mobile (conversation + voice buttons)
- **Real-time messaging**: WebSocket-based text relay with speech-to-text and text-to-speech
- **AI assistant**: OpenHands integration for interactive conversations and display content
- **QR code join flow**: Easy device onboarding with owner approval workflow
- **Session management**: Multiple concurrent conversations within a workspace

## Core Concepts

### User
A person who authenticates via GitHub OAuth. Users own workspaces and approve join requests.

### Workspace
An isolated environment owned by a user. Contains devices and sessions.
- Unique join code/URL for inviting others
- Owner-managed OpenHands API key (encrypted at rest)
- Messages are scoped to the workspace

### Session
A conversation with its own messages and display content.
- Multiple sessions can be active in a workspace simultaneously
- Each device displays one session at a time
- AI conversations are scoped to sessions

### Device Views

| View | Description | Use Case |
|------|-------------|----------|
| **Kiosk** | Large display area + collapsible sidebar with conversation & settings | Wall-mounted screen, tablet on stand |
| **Mobile** | Conversation view + voice recording buttons, settings in menu | Phone, handheld device |

Both views can send AND receive messages. View is auto-detected by screen size but can be changed in settings.

## Quick Start

### Prerequisites

- Node.js 20+
- npm
- GitHub OAuth App (see [Authentication](#authentication))

### Local Development

```bash
# Install dependencies
npm install

# Start both server and client in dev mode
npm run dev
```

This starts:
- Server on http://localhost:3001 (WebSocket at ws://localhost:3001/ws)
- Client on http://localhost:5173 (proxies /ws to server)

Open http://localhost:5173 to get started. Sign in with GitHub, create a workspace, and connect devices.

### Network Access (Multiple Devices)

The dev server listens on all interfaces for local network access:

```bash
# Find your hostname
hostname  # e.g., my-macbook.local

# Other devices can access via mDNS:
http://my-macbook.local:5173
```

**Note:** Speech-to-text requires HTTPS or localhost. On non-localhost URLs, STT may not work in Chrome.

### Development Scripts

```bash
npm run dev                # Run server + client
npm run dev -w server      # Server only
npm run dev -w client      # Client only
npm run build              # Production build
npm start                  # Start production server
```

## Joining a Workspace

New users join via QR code displayed on the workspace owner's kiosk:

1. **Kiosk displays QR code** with join URL
2. **User scans QR** and authenticates with GitHub
3. **Join request appears** on owner's kiosk with [Approve] / [Deny] buttons
4. **Owner approves** and user's device auto-connects
5. **User joins session** and can participate in conversations

Pending requests expire after 5 minutes.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  User (GitHub OAuth)                                            │
│       │                                                         │
│       ▼                                                         │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Workspace (owner: user, join code: ABC123)             │   │
│  │       │                                                  │   │
│  │       ▼                                                  │   │
│  │  ┌─────────────┐  ┌─────────────┐                       │   │
│  │  │  Session 1  │  │  Session 2  │                       │   │
│  │  │             │  │             │                       │   │
│  │  │ 🖥️ Kiosk 1  │  │ 📱 Phone 2  │                       │   │
│  │  │ 📱 Phone 1  │  │             │                       │   │
│  │  │             │  │             │                       │   │
│  │  │ [messages]  │  │ [messages]  │                       │   │
│  │  │ [display]   │  │ [display]   │                       │   │
│  │  └─────────────┘  └─────────────┘                       │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

For detailed architecture documentation, see [docs/DESIGN.md](docs/DESIGN.md).

## Authentication

Voice Relay uses GitHub OAuth for authentication. All users must sign in to access the application.

### Configuration

```bash
# Required
GITHUB_CLIENT_ID=your-github-client-id
GITHUB_CLIENT_SECRET=your-github-client-secret
JWT_SECRET=your-secure-random-secret
BASE_URL=https://your-domain.com  # For OAuth callbacks

# Optional
JWT_EXPIRES_IN=7d                 # Token expiration (default: 7d)
```

### Setup GitHub OAuth App

1. Go to https://github.com/settings/developers
2. Click **OAuth Apps** → **New OAuth App**
3. Fill in:
   - **Application name:** Voice Relay
   - **Homepage URL:** `https://your-domain.com`
   - **Authorization callback URL:** `https://your-domain.com/auth/github/callback`
4. Copy Client ID and generate Client Secret
5. Add credentials to your environment

### Migration Guide

If upgrading from a previous version, see [docs/MIGRATION.md](docs/MIGRATION.md) for breaking changes and migration steps.

## Storage Backends

Configure persistence via environment variables:

### SQLite (Recommended for Production)

```bash
STORE_DRIVER=sqlite
SQLITE_PATH=./data/messages.db
```

### Memory

In-memory storage. Fast but lost on restart.

```bash
STORE_DRIVER=memory
STORE_MAX_MESSAGES=100
```

### Redis

For multi-instance deployments with shared state.

```bash
STORE_DRIVER=redis
REDIS_URL=redis://localhost:6379
STORE_MAX_MESSAGES=100
```

## AI Assistant Integration

Voice Relay integrates with OpenHands AI for interactive conversations. AI auto-connects to sessions when devices join.

### Setup

1. Get an API key from [OpenHands Cloud](https://app.all-hands.dev)
2. Configure per-workspace in the workspace settings UI, or set globally:

```bash
OPENHANDS_CLOUD_API_KEY=your-api-key-here
```

### Usage

- AI auto-connects when a device joins a session
- Speak or type messages — AI responses appear in chat
- In kiosk mode, AI can display rich content (markdown, images) on the display area

### AI Status API

```bash
# Check if AI is available
GET /api/ai/status
# Returns: { available: boolean, message: string }
```

## Display API

Push content to kiosk displays programmatically (useful for AI and external integrations):

```bash
POST /api/display
Authorization: Bearer <session-secret>
Content-Type: application/json

{
  "sessionId": "session-uuid",
  "type": "markdown" | "image" | "clear",
  "content": "# Hello World",
  "title": "Optional title"
}
```

### Authentication

The Display API requires a session-specific bearer token. This secret is provided to the AI via the `DISPLAY_API_SECRET` environment variable during AI session initialization.

### Response

```json
{
  "success": true,
  "kioskCount": 2
}
```

For backward compatibility, `workspaceId` is also accepted but `sessionId` is preferred.

## Message Protocol

### Client → Server

```typescript
// Register device
{
  type: 'register',
  deviceId: string,
  workspaceId?: string,
  sessionId?: string,       // Auto-assigns to active session if omitted
  displayName: string,
  mode: 'mobile' | 'kiosk',
  screenWidth?: number,
  screenHeight?: number
}

// Update device settings
{
  type: 'update-device',
  displayName?: string,
  mode?: 'mobile' | 'kiosk',
  ttsEnabled?: boolean
}

// Send text message
{
  type: 'text',
  utteranceId: string,
  text: string,
  partial: boolean
}

// Respond to join request (owner only)
{
  type: 'join-response',
  requestId: string,
  approved: boolean
}
```

### Server → Client

```typescript
// Registration confirmed
{
  type: 'registered',
  deviceId: string,
  session: { id: string, name: string | null },
  deviceToken?: string,        // Only on first registration
  tokenExpiresAt?: string      // Only on first registration
}

// Device list update
{
  type: 'device-list',
  devices: [{ id, workspaceId, displayName, mode }]
}

// Text message
{
  type: 'text',
  utteranceId: string,
  workspaceId: string,
  senderId: string,
  senderName: string,
  text: string,
  partial: boolean,
  sessionId?: string
}

// Join request notification (to owner's kiosk)
{
  type: 'join-request',
  request: {
    id: string,
    workspaceId: string,
    user: { id, username, displayName, avatarUrl }
  }
}

// Join request resolved (to requesting device)
{
  type: 'join-resolved',
  requestId: string,
  approved: boolean,
  workspace?: { id, name, slug }
}

// Display content (to kiosks)
{
  type: 'display',
  display: { type, content, title }
}
```

## Environment Variables

### Server

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3001` |
| `HOST` | Bind address | `0.0.0.0` |
| `NODE_ENV` | Environment | `development` |

### Authentication (Required)

| Variable | Description |
|----------|-------------|
| `GITHUB_CLIENT_ID` | GitHub OAuth App Client ID |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth App Client Secret |
| `JWT_SECRET` | Secret for signing JWT tokens |
| `BASE_URL` | Application URL (for OAuth callbacks) |
| `JWT_EXPIRES_IN` | Token expiration (default: `7d`) |

### Storage

| Variable | Description | Default |
|----------|-------------|---------|
| `STORE_DRIVER` | Storage backend: `memory`, `sqlite`, `redis` | `memory` |
| `SQLITE_PATH` | SQLite database path | `./data/messages.db` |
| `REDIS_URL` | Redis connection URL | - |
| `STORE_MAX_MESSAGES` | Max messages to retain | `100` |

### Security

| Variable | Description |
|----------|-------------|
| `ENCRYPTION_SECRET` | Key for API key encryption (falls back to `JWT_SECRET`) |
| `TEST_AUTH_SECRET` | Enables test auth endpoint (development only) |

### AI Integration

| Variable | Description |
|----------|-------------|
| `OPENHANDS_CLOUD_API_KEY` | Global OpenHands API key (workspace keys override) |

## Testing

### Server Unit Tests (Vitest)

```bash
npm test -w server         # Run server tests
npm run test:watch -w server  # Watch mode
```

### End-to-End Tests (Playwright)

```bash
npm test                   # Run all E2E tests (headless)
npm run test:headed        # Run with browser visible
npm run test:ui            # Run with Playwright UI
```

### Smoke Tests

Production smoke tests for deployment verification:

```bash
SMOKE_TEST_URL=https://app.no-hands.dev npm run smoke
```

### Test Coverage

- Authentication flow (GitHub OAuth)
- Workspace creation and management
- QR code join flow and approval
- Session management
- Multi-device message relay
- AI integration
- Display API

## Browser Support

- **Speech-to-text**: Chrome, Edge (Web Speech API)
- **Text-to-speech**: All modern browsers
- **WebSocket**: All modern browsers

## Deployment

Production auto-deploys to `app.no-hands.dev` on merge to main.

For manual deployment instructions and server configuration, see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Documentation

- [DESIGN.md](docs/DESIGN.md) — Detailed architecture and data model
- [DEPLOYMENT.md](docs/DEPLOYMENT.md) — Production deployment guide
- [MIGRATION.md](docs/MIGRATION.md) — Breaking changes and upgrade instructions

## License

MIT
