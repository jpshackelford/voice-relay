# Voice Relay - Multi-User Architecture Design

## Overview

Voice Relay is a real-time voice/text communication platform that connects devices (kiosks and mobile phones) for speech-to-text and text-to-speech relay, with optional AI assistant integration.

**Current State**: Single-user prototype with 4 device modes (input, output, chat, kiosk), in-memory device registry, no authentication.

**Target State**: Multi-user platform with workspaces, GitHub OAuth authentication, persistent storage, and simplified device views (kiosk, mobile).

---

## 1. Core Concepts

### 1.1 User
A person who authenticates via GitHub OAuth. Users own workspaces.

### 1.2 Workspace
An isolated environment owned by a user. Contains devices and sessions. Think of it as a "room" or "channel" where devices communicate.

- Each workspace has a unique join code/URL
- Devices connect to a specific workspace
- Messages are relayed only within a workspace
- Owner provides their own OpenHands API key (encrypted in DB)

### 1.3 Device
A browser tab/app instance connected to a workspace. Two views:

| View | Description | Use Case |
|------|-------------|----------|
| **Kiosk** | Large display area + collapsible sidebar with conversation & settings | Wall-mounted screen, tablet on stand |
| **Mobile** | Conversation view + voice recording buttons, settings in menu | Phone, handheld device |

Both views can send AND receive messages. Settings are accessible from sidebar (kiosk) or menu (mobile) - not a separate view.

**Default behavior:**
- Large screen → Kiosk view (auto-detected by screen size)
- Small screen → Mobile view
- Device auto-creates session if none exists (so QR code is immediately available)

### 1.4 Session
A conversation with its own messages and display content. **Multiple sessions can be active** in a workspace simultaneously. Each device displays **one session at a time**.

**Session contains:**
- Conversation (messages)
- Display content (what kiosks show)
- AI conversation state (if connected)
- List of devices currently viewing this session
- Start/end timestamps

**Key concepts:**
- Workspace has 0-N active sessions
- Device is always in a session (no "lobby" state)
- Device can switch between sessions
- First device auto-creates a session

```
┌─────────────────────────────────────────────────────────────────┐
│                         WORKSPACE                                │
│                                                                  │
│   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │
│   │  Session A  │  │  Session B  │  │  Session C  │            │
│   │             │  │             │  │  (archived) │            │
│   │ 🖥️ Kiosk 1  │  │ 📱 Phone 2  │  │             │            │
│   │ 📱 Phone 1  │  │             │  │             │            │
│   │             │  │             │  │             │            │
│   │ [messages]  │  │ [messages]  │  │ [messages]  │            │
│   │ [display]   │  │ [display]   │  │ [read-only] │            │
│   └─────────────┘  └─────────────┘  └─────────────┘            │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Device connection flow:**

```
Device connects to workspace
         │
         ▼
    ┌─────────────────┐
    │ Active session  │──── Yes ────► Join most recent session
    │    exists?      │              (or session from QR code)
    └─────────────────┘
         │ No
         ▼
    Auto-create new session
    Display QR code for others to join
```

**Session lifecycle:**

| Action | Result |
|--------|--------|
| First device connects | Auto-creates session, shows QR |
| Device scans QR | Joins that specific session |
| User clicks [+ New] | Creates new session, switches to it |
| User clicks [Switch] | Picks from session list |
| Mobile casts to kiosk | Kiosk switches to that session |
| Owner ends session | Session archived, devices switch to another or create new |

**Typical flow:**

```
1. Owner opens kiosk on big screen
   └─► Auto-creates "Session 1", displays QR code

2. Coworker scans QR with phone
   └─► Joins "Session 1", can speak/type

3. Owner wants fresh start
   └─► Clicks [+ New], creates "Session 2"
   └─► Kiosk now shows "Session 2" with new QR

4. Another coworker joins via new QR
   └─► Joins "Session 2"
```

**Casting to kiosk:**

Mobile user can push their session to any kiosk in the workspace:

```
Mobile → [Cast 📺] → Select kiosk → Kiosk switches to this session
```

---

## 2. Architecture

### 2.1 System Components

```
┌─────────────────────────────────────────────────────────────────┐
│                         Clients                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │   Kiosk     │  │   Mobile    │  │   Mobile    │              │
│  │  (Browser)  │  │  (Browser)  │  │  (Browser)  │              │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘              │
│         │                │                │                      │
└─────────┼────────────────┼────────────────┼──────────────────────┘
          │                │                │
          │         WebSocket + REST        │
          │                │                │
┌─────────┴────────────────┴────────────────┴──────────────────────┐
│                         Server (Node.js)                          │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  Express + WebSocket Server                                 │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────────┐  │  │
│  │  │   Auth   │ │ Workspace│ │  Device  │ │    Session    │  │  │
│  │  │  GitHub  │ │  Manager │ │ Registry │ │    Manager    │  │  │
│  │  └──────────┘ └──────────┘ └──────────┘ └───────────────┘  │  │
│  └────────────────────────────────────────────────────────────┘  │
│                              │                                    │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  Storage Layer                                              │  │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────┐            │  │
│  │  │   SQLite   │  │  MariaDB   │  │   Redis    │            │  │
│  │  │   (dev)    │  │  (prod)    │  │ (optional) │            │  │
│  │  └────────────┘  └────────────┘  └────────────┘            │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
                              │
                    ┌─────────┴─────────┐
                    │  OpenHands Cloud  │
                    │   (AI Assistant)  │
                    └───────────────────┘
```

### 2.2 Technology Stack

| Layer | Technology | Notes |
|-------|------------|-------|
| Frontend | React + TypeScript + Vite | Existing client |
| Backend | Node.js + Express + TypeScript | Existing server |
| WebSocket | ws library | Real-time messaging |
| Database | SQLite (dev) / MariaDB (prod) | User accounts, workspaces |
| Auth | GitHub OAuth | Most users have GitHub |
| Session | JWT | Stateless auth tokens |

**No Docker** - Simple systemd deployment.

---

## 3. Data Model

### 3.1 Database Schema

```sql
-- Users (from GitHub OAuth)
CREATE TABLE users (
  id VARCHAR(36) PRIMARY KEY,           -- UUID
  github_id INTEGER UNIQUE NOT NULL,    -- GitHub user ID
  username VARCHAR(255) NOT NULL,       -- GitHub username
  display_name VARCHAR(255),            -- Full name
  avatar_url VARCHAR(500),              -- GitHub avatar
  email VARCHAR(255),                   -- GitHub email (optional)
  created_at TIMESTAMP DEFAULT NOW(),
  last_login_at TIMESTAMP
);

-- Workspaces
CREATE TABLE workspaces (
  id VARCHAR(36) PRIMARY KEY,           -- UUID
  owner_id VARCHAR(36) NOT NULL REFERENCES users(id),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(100) UNIQUE NOT NULL,    -- URL-friendly identifier
  join_code VARCHAR(20) UNIQUE,         -- Short code for easy joining
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP
);

-- Workspace Settings (separate table for sensitive data)
CREATE TABLE workspace_settings (
  workspace_id VARCHAR(36) PRIMARY KEY REFERENCES workspaces(id),
  openhands_api_key_encrypted TEXT,     -- AES-256-GCM encrypted
  openhands_api_key_iv VARCHAR(32),     -- Initialization vector (hex)
  openhands_api_key_tag VARCHAR(32),    -- Auth tag (hex)
  tts_voice VARCHAR(100),               -- Preferred TTS voice
  stt_language VARCHAR(10),             -- STT language code
  updated_at TIMESTAMP
);

-- Devices (registered devices, persisted)
CREATE TABLE devices (
  id VARCHAR(36) PRIMARY KEY,           -- UUID
  workspace_id VARCHAR(36) NOT NULL REFERENCES workspaces(id),
  name VARCHAR(255) NOT NULL,           -- User-friendly name
  view VARCHAR(20) NOT NULL,            -- 'kiosk' or 'mobile'
  device_token VARCHAR(255) UNIQUE,     -- For device re-auth without user
  last_seen_at TIMESTAMP,
  config JSON,                          -- Device-specific settings
  created_at TIMESTAMP DEFAULT NOW()
);

-- Sessions (voice interaction periods)
CREATE TABLE sessions (
  id VARCHAR(36) PRIMARY KEY,           -- UUID
  workspace_id VARCHAR(36) NOT NULL REFERENCES workspaces(id),
  started_at TIMESTAMP DEFAULT NOW(),
  ended_at TIMESTAMP,
  metadata JSON                         -- AI conversation ID, stats, etc.
);

-- Messages (within sessions)
CREATE TABLE messages (
  id VARCHAR(36) PRIMARY KEY,           -- UUID
  session_id VARCHAR(36) NOT NULL REFERENCES sessions(id),
  device_id VARCHAR(36) REFERENCES devices(id),
  sender_name VARCHAR(255) NOT NULL,
  text TEXT NOT NULL,
  is_ai BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_workspaces_owner ON workspaces(owner_id);
CREATE INDEX idx_workspaces_slug ON workspaces(slug);
CREATE INDEX idx_devices_workspace ON devices(workspace_id);
CREATE INDEX idx_sessions_workspace ON sessions(workspace_id);
CREATE INDEX idx_messages_session ON messages(session_id);
```

### 3.2 Relationships

```
User (1) ─────< (N) Workspace
                    │
                    ├───< (N) Device
                    │
                    └───< (N) Session ───< (N) Message
```

---

## 4. Authentication & Authorization

**GitHub OAuth only** - No email/SMS self-service (requires infra we don't have).

All users must have a GitHub account to create workspaces or join as authenticated users.

### 4.1 GitHub OAuth Flow

```
┌────────┐     ┌────────┐     ┌────────┐     ┌────────┐
│ Client │     │ Server │     │ GitHub │     │   DB   │
└───┬────┘     └───┬────┘     └───┬────┘     └───┬────┘
    │              │              │              │
    │ GET /auth/github            │              │
    │─────────────>│              │              │
    │              │              │              │
    │ Redirect to GitHub          │              │
    │<─────────────│              │              │
    │              │              │              │
    │ User authorizes on GitHub   │              │
    │──────────────────────────────>              │
    │              │              │              │
    │ Callback with code          │              │
    │─────────────>│              │              │
    │              │              │              │
    │              │ Exchange code for token     │
    │              │─────────────>│              │
    │              │              │              │
    │              │ Access token │              │
    │              │<─────────────│              │
    │              │              │              │
    │              │ Fetch user info             │
    │              │─────────────>│              │
    │              │              │              │
    │              │ User data    │              │
    │              │<─────────────│              │
    │              │              │              │
    │              │ Create/update user          │
    │              │─────────────────────────────>│
    │              │              │              │
    │ JWT token    │              │              │
    │<─────────────│              │              │
```

### 4.2 Token Types

| Token | Purpose | Lifetime | Storage |
|-------|---------|----------|---------|
| User JWT | Authenticate user for API/WebSocket | 7 days | localStorage |
| Device Token | Allow device reconnect without full auth | 90 days | IndexedDB |
| Workspace Join Code | Allow guests to join workspace | Permanent | DB |

### 4.3 Mobile Device Persistence

iOS Safari aggressively clears localStorage, so we can't rely on true device fingerprinting. Instead:

```
First Visit (phone):
┌────────────┐     ┌────────────┐     ┌────────────┐
│   Phone    │     │   Server   │     │   GitHub   │
└─────┬──────┘     └─────┬──────┘     └─────┬──────┘
      │                  │                  │
      │ Scan QR / enter join code          │
      │─────────────────>│                  │
      │                  │                  │
      │ Redirect to GitHub OAuth           │
      │<─────────────────│                  │
      │                  │                  │
      │ Authenticate ────────────────────────>
      │                  │                  │
      │ User JWT + Device Token            │
      │<─────────────────│                  │
      │                  │                  │
      │ Store in IndexedDB (more durable)  │
      └────────────────────────────────────┘

Subsequent Visits:
┌────────────┐     ┌────────────┐
│   Phone    │     │   Server   │
└─────┬──────┘     └─────┬──────┘
      │                  │
      │ Check IndexedDB for device token
      │                  │
      │ Connect with device token
      │─────────────────>│
      │                  │
      │ Token valid → auto-join workspace
      │<─────────────────│
      │                  │
      │ (No GitHub login needed)
      └──────────────────┘
```

**Why IndexedDB over localStorage:**
- More persistent on iOS Safari
- Survives "Clear History" in some cases
- Larger storage quota
- Async API (doesn't block)

**If token is lost/expired:**
- User must re-authenticate via GitHub
- New device token issued
- Old token invalidated

### 4.4 Authorization Rules

| Action | Who Can Do It |
|--------|---------------|
| Create workspace | Authenticated user |
| View workspace | Owner + anyone with join code |
| Edit workspace settings | Owner only |
| Delete workspace | Owner only |
| Register device | Anyone with workspace access |
| Send/receive messages | Any device in workspace |

---

## 5. API Design

### 5.1 REST Endpoints

#### Auth
```
GET  /auth/github                    # Redirect to GitHub OAuth
GET  /auth/github/callback           # OAuth callback, returns JWT
GET  /auth/me                        # Get current user (requires JWT)
POST /auth/logout                    # Invalidate session
```

#### Users
```
GET  /api/users/me                   # Get current user profile
PATCH /api/users/me                  # Update profile
```

#### Workspaces
```
GET    /api/workspaces               # List user's workspaces
POST   /api/workspaces               # Create workspace
GET    /api/workspaces/:id           # Get workspace details
PATCH  /api/workspaces/:id           # Update workspace
DELETE /api/workspaces/:id           # Delete workspace
POST   /api/workspaces/:id/join      # Join via code (returns device token)
```

#### Workspace Settings (owner only)
```
GET    /api/workspaces/:id/settings  # Get settings (API key masked)
PATCH  /api/workspaces/:id/settings  # Update settings (incl. API key)
DELETE /api/workspaces/:id/settings/api-key  # Remove API key
```

Settings response example:
```json
{
  "openhands_api_key_set": true,      // Boolean, never expose actual key
  "tts_voice": "en-US-Wavenet-D",
  "stt_language": "en-US"
}
```

#### Devices
```
GET    /api/workspaces/:id/devices   # List devices in workspace
POST   /api/workspaces/:id/devices   # Register new device
GET    /api/devices/:id              # Get device details
PATCH  /api/devices/:id              # Update device
DELETE /api/devices/:id              # Remove device
POST   /api/devices/:id/token        # Generate new device token
```

#### Sessions
```
GET    /api/workspaces/:id/sessions  # List sessions
POST   /api/workspaces/:id/sessions  # Start new session
GET    /api/sessions/:id             # Get session with messages
PATCH  /api/sessions/:id             # End session
```

#### AI
```
GET    /api/ai/status                # Check AI availability
POST   /api/ai/connect               # Connect AI to device
POST   /api/ai/message               # Send message to AI
DELETE /api/ai/disconnect            # Disconnect AI
```

#### Display (for AI to send content to kiosks)
```
POST   /api/display                  # Send content to kiosk displays
```

### 5.2 WebSocket Protocol

#### Connection
```
ws://host/ws?token=<jwt_or_device_token>&workspace=<workspace_id>
```

#### Client → Server Messages
```typescript
// Register device in workspace
{ 
  type: 'register',
  deviceId: string,
  displayName: string,
  view: 'mobile' | 'kiosk',
  screenWidth?: number,   // Kiosk only
  screenHeight?: number   // Kiosk only
}

// Update device settings
{
  type: 'update-device',
  displayName?: string,
  view?: 'mobile' | 'kiosk',
  ttsEnabled?: boolean
}

// Send text message
{
  type: 'text',
  utteranceId: string,    // Client-generated UUID
  text: string,
  partial: boolean        // true = still typing
}
```

#### Server → Client Messages
```typescript
// Registration confirmed
{ type: 'registered', deviceId: string }

// Device list update
{ 
  type: 'device-list',
  devices: [{ id, displayName, view }]
}

// Message history (on connect)
{
  type: 'history',
  messages: [{ utteranceId, senderId, senderName, text, partial }]
}

// Relayed text message
{
  type: 'text',
  utteranceId: string,
  senderId: string,
  senderName: string,
  text: string,
  partial: boolean
}

// Display content (kiosk only)
{
  type: 'display',
  display: { type: 'markdown' | 'image' | 'clear', content?, title? }
}

// AI status update
{
  type: 'ai-status',
  connected: boolean,
  conversationId?: string
}
```

---

## 6. User Flows

### 6.1 New User Setup

```
1. User visits app → sees "Sign in with GitHub" button
2. User clicks → redirects to GitHub OAuth
3. GitHub authenticates → redirects back with code
4. Server exchanges code → creates user account
5. Server issues JWT → redirects to dashboard
6. User creates first workspace → gets join code
7. User opens kiosk view on big screen
8. User scans QR code with phone → mobile view connects
9. Both devices ready for voice relay
```

### 6.2 Joining Existing Workspace

```
1. User receives workspace link/code from owner
2. User visits /join/:code or enters code manually
3. If authenticated: adds workspace to their account
4. If not authenticated: redirected to GitHub login first
5. Device registered in workspace
6. User can now participate
```

### 6.3 Device Reconnection

```
1. Device has stored device token in localStorage
2. On page load, attempts WebSocket connect with token
3. If valid: device auto-registers, receives history
4. If expired: prompts for re-authentication
```

---

## 7. Frontend Structure

### 7.1 Routes

```
/                           # Landing page (unauthenticated)
/auth/github                # Start OAuth flow
/auth/callback              # OAuth callback handler
/dashboard                  # User's workspace list
/workspace/:slug            # Workspace detail/management
/workspace/:slug/kiosk      # Kiosk view (full screen)
/workspace/:slug/mobile     # Mobile view
/join/:code                 # Join workspace by code
```

### 7.2 Components

```
src/
├── components/
│   ├── KioskMode.tsx       # Full-screen kiosk display + sidebar
│   ├── MobileMode.tsx      # Compact conversation + voice buttons
│   ├── SettingsView.tsx    # Workspace management
│   ├── DeviceSetup.tsx     # Device name/view selection
│   ├── QRCode.tsx          # QR code for mobile join
│   └── JoinRequest.tsx     # Approval modal for kiosk
├── hooks/
│   ├── useAuth.ts          # Authentication state
│   ├── useWebSocket.ts     # WebSocket connection
│   ├── useSpeechRecognition.ts
│   ├── useSpeechSynthesis.ts
│   └── useAI.ts
└── types.ts
```

### 7.3 Settings View

Accessible via gear icon on kiosk/mobile, or directly at `/workspace/:slug/settings`.

**Owner only** - workspace members cannot access settings.

```
┌─────────────────────────────────────────────────────────┐
│  ⚙️ Workspace Settings                          [Back] │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  WORKSPACE                                              │
│  ┌─────────────────────────────────────────────────┐   │
│  │ Name: [My Workspace          ]                  │   │
│  │ Slug: my-workspace (read-only)                  │   │
│  │ Join URL: https://app.example.com/join/abc123   │   │
│  │           [Show QR Code]                        │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  AI ASSISTANT                                           │
│  ┌─────────────────────────────────────────────────┐   │
│  │ OpenHands API Key:                              │   │
│  │ [••••••••••••••••••••••] [Save] [Clear]        │   │
│  │ Status: ✓ Connected / ✗ Not configured         │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  DEVICES (3 connected)                                  │
│  ┌─────────────────────────────────────────────────┐   │
│  │ 🖥️ Living Room Kiosk    online   [Rename] [×]  │   │
│  │ 📱 John's iPhone        online   [Rename] [×]  │   │
│  │ 📱 Kitchen Tablet       offline  [Rename] [×]  │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  MEMBERS (2)                                            │
│  ┌─────────────────────────────────────────────────┐   │
│  │ 👤 jpshackelford (owner)                        │   │
│  │ 👤 alice         member since May 1   [Remove] │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  SESSIONS                                               │
│  ┌─────────────────────────────────────────────────┐   │
│  │ May 5, 2025 10:30am - 11:45am  (3 devices)     │   │
│  │ May 4, 2025 2:00pm - 2:30pm    (2 devices)     │   │
│  │ [Load more...]                                  │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  DANGER ZONE                                            │
│  ┌─────────────────────────────────────────────────┐   │
│  │ [Delete Workspace]                              │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**Sections:**
1. **Workspace** - Name, slug, join URL/QR
2. **AI Assistant** - OpenHands API key (masked input), connection status
3. **Devices** - List connected/offline devices, rename/remove
4. **Members** - List workspace members, remove (owner can't remove self)
5. **Sessions** - Historical session list with timestamps
6. **Danger Zone** - Delete workspace (requires confirmation)

### 7.4 Session & Settings Controls

**Kiosk layout:**
```
┌────────────────────────────────────────────────────────────────────┐
│ Collapsible Sidebar                    │      Display Area        │
│ ┌────────────────────────────────────┐ │                          │
│ │ Session: Project Alpha    [+ New]  │ │                          │
│ │ 3 devices         [Switch ▼] [End] │ │    (AI content or        │
│ ├────────────────────────────────────┤ │     "Ready" state)       │
│ │                                    │ │                          │
│ │  [conversation messages]           │ │                          │
│ │                                    │ │                          │
│ │                                    │ │ ┌──────────┐             │
│ │                                    │ │ │ QR CODE  │             │
│ │                                    │ │ │ to join  │             │
│ ├────────────────────────────────────┤ │ └──────────┘             │
│ │ [text input] [🎤] [⚙️ Settings]    │ │                          │
│ └────────────────────────────────────┘ │                          │
└────────────────────────────────────────────────────────────────────┘
```

**Mobile layout:**
```
┌─────────────────────────────────┐
│ Project Alpha     [Cast] [☰]   │  ← menu has: Switch, New, End, Settings
│ 3 devices                       │
├─────────────────────────────────┤
│                                 │
│  [conversation messages]        │
│                                 │
├─────────────────────────────────┤
│ [text input]        [🎤] [Send] │
└─────────────────────────────────┘
```

**Settings panel** (slides in from sidebar or menu):
```
┌─────────────────────────────────┐
│ ⚙️ Settings              [Close]│
├─────────────────────────────────┤
│ WORKSPACE                       │
│ Name: [My Workspace        ]    │
│ Join URL: [Show QR]             │
│                                 │
│ AI ASSISTANT                    │
│ API Key: [••••••••] [Save]      │
│ Status: ✓ Connected             │
│                                 │
│ DEVICES (3)                     │
│ 🖥️ Kiosk 1 (this)    online    │
│ 📱 Phone 1           online    │
│ 📱 Phone 2           offline   │
│                                 │
│ MEMBERS (2)                     │
│ 👤 jpshackelford (owner)        │
│ 👤 alice            [Remove]    │
│                                 │
│ [Delete Workspace]              │
└─────────────────────────────────┘
```

**WebSocket messages:**
```typescript
// Device registers, server auto-assigns to session
{ type: 'register', deviceId, displayName, view, workspaceId }

// Server responds with session info
{ type: 'registered', deviceId, session: { id, name } }

// Create new session (switch to it)
{ type: 'create-session', name?: string }

// Switch to different session
{ type: 'switch-session', sessionId: string }

// Cast current session to a kiosk
{ type: 'cast-session', targetDeviceId: string }

// End session (owner only)
{ type: 'end-session', sessionId: string }

// Server broadcasts session changes
{ type: 'session-update', session: { id, name, deviceCount } }
{ type: 'session-ended', sessionId, endedBy }
{ type: 'session-cast', session: { id, name }, byUser }
```

**API endpoints:**
```
POST   /api/workspaces/:id/sessions              # Create session
GET    /api/workspaces/:id/sessions              # List active sessions  
DELETE /api/workspaces/:id/sessions/:sid         # End/archive session
POST   /api/workspaces/:id/sessions/:sid/cast    # Cast to device
```

---

## 8. Deployment

### 8.1 Development

```bash
# Install dependencies
npm install

# Set environment variables
cp .env.example .env
# Edit .env with GitHub OAuth credentials

# Start dev server (SQLite auto-created)
npm run dev

# Access at http://localhost:5173
```

### 8.2 Production (systemd)

```ini
# /etc/systemd/system/voice-relay.service
[Unit]
Description=Voice Relay Server
After=network.target

[Service]
Type=simple
User=voice-relay
WorkingDirectory=/opt/voice-relay
ExecStart=/usr/bin/node dist/server/index.js
Restart=always
Environment=NODE_ENV=production
Environment=PORT=3001
EnvironmentFile=/etc/voice-relay/env

[Install]
WantedBy=multi-user.target
```

```bash
# /etc/voice-relay/env
DATABASE_URL=mysql://user:pass@localhost:3306/voice_relay
GITHUB_CLIENT_ID=xxx
GITHUB_CLIENT_SECRET=xxx
OPENHANDS_CLOUD_API_KEY=xxx
JWT_SECRET=xxx
```

### 8.3 Database Setup (MariaDB)

```sql
CREATE DATABASE voice_relay CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'voice_relay'@'localhost' IDENTIFIED BY 'password';
GRANT ALL PRIVILEGES ON voice_relay.* TO 'voice_relay'@'localhost';
```

---

## 9. Migration Path

### Phase 1: Add Database Layer (keep existing functionality)
- [ ] Add SQLite/MariaDB storage abstraction
- [ ] Create schema and migrations
- [ ] Store messages in DB instead of in-memory

### Phase 2: Authentication
- [ ] Add GitHub OAuth endpoints
- [ ] Create user accounts on first login
- [ ] JWT token generation and validation
- [ ] Protect API endpoints

### Phase 3: Workspaces
- [ ] Add workspace CRUD operations
- [ ] Scope device registry per workspace
- [ ] Add join codes
- [ ] Update WebSocket to require workspace context

### Phase 4: UI Simplification
- [ ] Remove input/output modes (keep kiosk + mobile only)
- [ ] Add dashboard for workspace management
- [ ] Add auth UI (login, logout)
- [ ] Update routing

### Phase 5: Polish
- [ ] Device tokens for reconnection
- [ ] Session tracking
- [ ] QR code improvements
- [ ] Error handling and validation

---

## 10. Encryption

### 10.1 API Key Encryption

Workspace owners provide their OpenHands API key, which is sensitive and must be encrypted at rest.

**Approach**: AES-256-GCM (authenticated encryption)

```typescript
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY; // 32 bytes, hex-encoded

function encrypt(plaintext: string): { encrypted: string; iv: string; tag: string } {
  const key = Buffer.from(ENCRYPTION_KEY, 'hex');
  const iv = randomBytes(12); // 96-bit IV for GCM
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  
  return { encrypted, iv: iv.toString('hex'), tag };
}

function decrypt(encrypted: string, iv: string, tag: string): string {
  const key = Buffer.from(ENCRYPTION_KEY, 'hex');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));
  
  let plaintext = decipher.update(encrypted, 'hex', 'utf8');
  plaintext += decipher.final('utf8');
  
  return plaintext;
}
```

**Key Management**:
- `ENCRYPTION_KEY` stored in environment variable (not in DB)
- Generate with: `openssl rand -hex 32`
- Same key used across all workspaces
- Key rotation: re-encrypt all API keys with new key, then swap

### 10.2 What Gets Encrypted

| Data | Storage | Encrypted? |
|------|---------|------------|
| User passwords | N/A (OAuth only) | N/A |
| OpenHands API keys | DB | Yes (AES-256-GCM) |
| JWT tokens | Client localStorage | Signed, not encrypted |
| Device tokens | DB + client | Hashed in DB |
| Join codes | DB | No (not sensitive) |

---

## 11. Scope & Deferred Features

### V1 Scope
- GitHub OAuth required for all users
- Single owner per workspace (no sharing)
- Owner manages their own devices
- Message history: per-session (cleared when session ends)
- No hard limits on devices/workspaces initially

### Deferred (V2+)
- **Persistent message history**: Configurable retention policies
- **Rate limiting**: For public-facing auth endpoints

---

## 12. QR Code Join Flow (Multi-User)

The kiosk acts as the approval interface for new users joining a workspace. No email/SMS needed.

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌────────┐
│    Kiosk    │     │   Phone     │     │   Server    │     │ GitHub │
│  (Owner)    │     │ (New User)  │     │             │     │        │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘     └───┬────┘
       │                   │                   │                │
       │ Display QR code   │                   │                │
       │ (join URL)        │                   │                │
       │◄──────────────────│                   │                │
       │                   │                   │                │
       │                   │ Scan QR           │                │
       │                   │──────────────────►│                │
       │                   │                   │                │
       │                   │ Redirect to GitHub│                │
       │                   │◄──────────────────│                │
       │                   │                   │                │
       │                   │ Authenticate      │                │
       │                   │───────────────────────────────────►│
       │                   │                   │                │
       │                   │ Auth complete     │                │
       │                   │◄───────────────────────────────────│
       │                   │                   │                │
       │                   │ Request to join   │                │
       │                   │──────────────────►│                │
       │                   │                   │                │
       │ "Alice wants to   │                   │                │
       │  join" [Approve]  │                   │                │
       │◄──────────────────────────────────────│                │
       │                   │                   │                │
       │ Owner clicks      │                   │                │
       │ [Approve]         │                   │                │
       │──────────────────────────────────────►│                │
       │                   │                   │                │
       │                   │ "Approved!"       │                │
       │                   │◄──────────────────│                │
       │                   │                   │                │
       │                   │ Auto-connect to   │                │
       │                   │ workspace         │                │
       └───────────────────┴───────────────────┘                │
```

### Data Model Addition

```sql
-- Pending join requests
CREATE TABLE workspace_join_requests (
  id VARCHAR(36) PRIMARY KEY,
  workspace_id VARCHAR(36) NOT NULL REFERENCES workspaces(id),
  user_id VARCHAR(36) NOT NULL REFERENCES users(id),
  status VARCHAR(20) DEFAULT 'pending',  -- pending, approved, denied
  created_at TIMESTAMP DEFAULT NOW(),
  resolved_at TIMESTAMP,
  resolved_by VARCHAR(36) REFERENCES users(id)
);

-- Workspace members (approved users)
CREATE TABLE workspace_members (
  workspace_id VARCHAR(36) REFERENCES workspaces(id),
  user_id VARCHAR(36) REFERENCES users(id),
  role VARCHAR(20) DEFAULT 'member',  -- owner, member
  joined_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (workspace_id, user_id)
);
```

### WebSocket Messages

```typescript
// Server → Kiosk: New join request
{
  type: 'join-request',
  request: {
    id: string,
    user: { id, username, displayName, avatarUrl },
    createdAt: string
  }
}

// Kiosk → Server: Approve/deny request
{
  type: 'join-response',
  requestId: string,
  approved: boolean
}

// Server → Phone: Request resolved
{
  type: 'join-resolved',
  approved: boolean,
  workspace?: { id, name, slug }  // Only if approved
}
```

### API Endpoints

```
GET  /api/workspaces/:id/requests      # List pending requests (owner only)
POST /api/workspaces/:id/join          # Request to join (after GitHub auth)
POST /api/workspaces/:id/requests/:id/approve  # Approve request
POST /api/workspaces/:id/requests/:id/deny     # Deny request
GET  /api/workspaces/:id/members       # List workspace members
DELETE /api/workspaces/:id/members/:userId  # Remove member
```

### UX Details

- QR code contains: `https://app.example.com/join/{workspace_slug}`
- Join page shows workspace name, owner avatar
- After GitHub auth, phone shows "Waiting for approval..." spinner
- Kiosk shows toast/modal: "Alice (alice@github) wants to join" [Approve] [Deny]
- On approve: phone instantly connects, shows workspace
- On deny: phone shows "Request denied" message
- Pending requests expire after 5 minutes

---

## 13. Security Considerations

- All auth tokens over HTTPS only
- JWT secrets rotated periodically  
- GitHub OAuth state parameter to prevent CSRF
- WebSocket connections validate token on connect
- Workspace join codes should be unguessable (UUID or random string)
- Input sanitization for display names and messages
- Rate limiting on auth endpoints
