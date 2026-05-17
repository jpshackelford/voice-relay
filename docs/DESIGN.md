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
| Create workspace | Any authenticated user |
| Edit workspace settings | Owner only |
| Delete workspace | Owner only |
| Approve/deny join requests | Owner only |
| End session | Owner only |

**Joining a workspace (via QR code or direct link):**

```
User scans QR / opens join link
         │
         ▼
    ┌─────────────────┐
    │  Authenticated? │──── No ────► Redirect to GitHub login
    └─────────────────┘              (then return to join flow)
         │ Yes
         ▼
    ┌─────────────────┐
    │ Already member  │──── Yes ───► Join session immediately
    │ of workspace?   │              (can see & interact)
    └─────────────────┘
         │ No
         ▼
    ┌─────────────────┐
    │ Is workspace    │──── Yes ───► Join session immediately
    │ owner?          │              (can see & interact)
    └─────────────────┘
         │ No
         ▼
    Create pending join request
    Show "Waiting for approval..." screen
    (cannot see conversation or display)
         │
         ▼
    Owner sees request on kiosk
    [Approve] or [Deny]
         │
    ┌────┴────┐
    │         │
 Approved   Denied
    │         │
    ▼         ▼
 Add to    Show "Request
 members,  denied" message
 join session
```

**Authorization by state:**

| User State | Join Session | See Content | Send Messages |
|------------|--------------|-------------|---------------|
| Workspace owner | ✅ | ✅ | ✅ |
| Workspace member | ✅ | ✅ | ✅ |
| Pending approval | ❌ | ❌ | ❌ |
| Not authenticated | ❌ | ❌ | ❌ |

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

### Phase 1: Add Database Layer (keep existing functionality) ✅ [PR #1](https://github.com/jpshackelford/voice-relay/pull/1)
- [x] Add SQLite/MariaDB storage abstraction (SQLite implemented, MariaDB deferred)
- [x] Create schema and migrations (Migrator class + initial messages migration)
- [x] Store messages in DB instead of in-memory (existing behavior preserved)

**Implementation Notes (2026-05-05):**
- Added `Migrator` class with up/down migrations, version tracking, transaction safety
- Migrations stored in `server/src/storage/migrations/` as TypeScript modules
- SQLiteStore now auto-runs migrations on connect()
- Added vitest for unit testing with >95% coverage on new code (54 tests total)
- Backward compatible with existing sqlite.db in production

**Learnings:**
- The migration uses `CREATE TABLE IF NOT EXISTS` which works well for existing databases
- Transaction wrapping ensures atomicity - if a migration fails partway, previous state preserved
- Real SQLite tests (no mocking) catch actual database behavior issues
- Client TypeScript has pre-existing type errors (DeviceMode mismatch) - separate issue from Phase 1
- Production auto-deploys on merge to main via GitHub Actions

### Phase 2: Authentication ✅ [PR #2](https://github.com/jpshackelford/voice-relay/pull/2)
- [x] Add GitHub OAuth endpoints (`/auth/github`, `/auth/github/callback`)
- [x] Create user accounts on first login (upsert pattern)
- [x] JWT token generation and validation (7-day expiry)
- [x] Protect API endpoints (requireAuth/optionalAuth middleware)

**Implementation Notes:**
- Auth conditionally enabled when `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `JWT_SECRET` env vars are set
- User profile synced with GitHub on each login
- CSRF protection via OAuth state parameter stored in memory (will need Redis for multi-server)
- Migration uses `CREATE TABLE IF NOT EXISTS` - safe additive change for production
- Tests cover >97% of auth module (87 tests total)

**Learnings:**
- Conditional feature enablement (via env vars) allows zero-risk deployment
- Real SQLite tests with in-memory databases catch edge cases mocking would miss
- CSRF state cleanup with timeout prevents memory leaks
- Upsert pattern keeps user profiles synced with GitHub automatically

**Post-Deploy Setup:**
1. Create GitHub OAuth App: `https://github.com/settings/applications/new`
2. Set callback URL: `https://app.no-hands.dev/auth/github/callback`
3. Configure env vars: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `JWT_SECRET`, `BASE_URL`

**Future Work (deferred to Phase 4):**
- Client-side auth UI (login button, token storage, logout)
- CI workflow for PR checks

### Phase 3: Workspaces — **COMPLETE** (PR #3)
- [x] Add workspace CRUD operations
- [x] Add join codes
- [x] Scope device registry per workspace (completed in Phase 3.5)
- [x] Update WebSocket to require workspace context (completed in Phase 3.5)

**Completed in PR #3:**
- Database migration (003_workspaces.ts) with tables: workspaces, workspace_settings, workspace_members
- Workspace repository with full CRUD, auto-generated slugs, join code generation (XXXX-XXXX), member management
- REST API router with auth middleware at /api/workspaces (12 endpoints)
- Access control: owner-only for sensitive operations, member-based workspace access
- 44 new tests (29 repository + 15 utilities), all 131 tests passing

**Technical Decisions:**
- Join codes use distinguishable character set (excludes 0/O/1/I for verbal sharing)
- API key storage with encrypted/iv/tag pattern for AES-GCM encryption
- Simplified role model: owner/member (not admin) for initial implementation

### Phase 3.5: Device Registry & WebSocket Integration — **COMPLETE** (PR #5)
- [x] Scope device registry per workspace
- [x] Update WebSocket to require workspace context
- [x] Connect devices to workspaces on registration

**Completed in PR #5:**
- Add workspaceId to Device, RegisterMessage, and DeviceInfo types
- DeviceRegistry now supports workspace-scoped queries (getDevicesByWorkspace, etc.)
- All broadcast methods (broadcastToOutputs, broadcastDeviceList) scope to workspace
- WebSocket handler requires workspaceId in register message
- REST API endpoints updated to support workspace context
- 28 new tests for DeviceRegistry (161 total tests passing)
- 96.9% statement coverage for registry.ts

**Breaking Changes & Backward Compatibility:**
- WebSocket `register` message now supports optional `workspaceId` field (defaults to 'default')
- Clients that don't provide workspaceId will use 'default' workspace (backward compatible)
- Clients should be updated to provide workspace context for proper isolation
- REST `/api/display` endpoint now requires `workspaceId` parameter

**Migration Notes:**
- Migration 004 is additive and safe for existing data
- Existing messages assigned to 'default' workspace
- No manual steps required post-deploy

**Review Feedback Applied:**
- RegisterMessage.workspaceId made optional (defaults to 'default' for backward compat)
- Created DisplayRequest interface for proper type safety
- Migration 004 now sets existing messages' workspace_id to 'default'
- Deferred workspace validation to Phase 4 (see issue #6) - half-validation
  created inconsistent security model, so validation removed until proper
  user auth is implemented

**Next Steps:**
- Phase 4: Add workspace validation alongside user authentication
- Phase 4: Client updates to provide workspaceId on connect

**Learnings for Future Work:**
- Half-validation (checking some but not all security properties) creates inconsistent security models; defer validation entirely until full auth is in place
- Adding workspace scoping as a data structure change (adding workspaceId to models) is more maintainable than complex conditional logic
- Session support will build on top of workspace isolation in Phase 5; workspaces contain multiple sessions with their own conversation history and device participation

### Phase 4: UI & Auth Integration — **COMPLETE** (PR #6)

**Completed Tasks:**
- [x] Device modes simplified (done in PR #4) - kiosk + mobile only
- [x] Dashboard for workspace management (create, join, delete workspaces)
- [x] Auth UI (login page with GitHub OAuth, logout support)
- [x] Update routing (React Router with auth-protected routes)
- [x] Client: provide workspaceId on WebSocket connect
- [x] Add API/auth 404 fallbacks for proper error responses

**Implementation Details:**

1. **Authentication Context** (`client/src/contexts/AuthContext.tsx`)
   - Server-side httpOnly cookies for secure token storage (not accessible to JS)
   - Auto-redirect to login when unauthenticated
   - User profile fetched from `/auth/me` endpoint
   - Automatic token refresh every 30 minutes to keep session alive

2. **Workspace Hook** (`client/src/hooks/useWorkspaces.ts`)
   - List, create, join, delete workspace operations
   - JWT-authenticated API calls
   - Error handling for auth failures

3. **Pages Added:**
   - `Login.tsx` - GitHub OAuth initiation, error display
   - `Dashboard.tsx` - Workspace list, create/join forms
   - `Workspace.tsx` - Auth-protected workspace page with device mode selection

4. **Server Improvements:**
   - API 404 fallback before SPA fallback (proper error responses)
   - Auth 404 fallback when auth not configured
   - `/health` endpoint added to vite proxy config

**Breaking Changes:**
- Root URL now redirects to `/login` when not authenticated
- `/workspace/:id` route requires authentication
- WebSocket `register` message requires `workspaceId` field

**Learnings:**
- SPA fallback was catching unregistered API routes - need explicit 404 handlers
- E2E tests need flexible assertions when auth config may vary (401 vs 404)
- Vite proxy config must include all backend endpoints used by tests
- Security review caught token exposure in URL params - httpOnly cookies are the right pattern
- React Router v7 has built-in TypeScript types - don't install `@types/react-router-dom`
- Token refresh is essential for good UX - implement proactive refresh before expiry
- Migration documentation is critical for breaking changes affecting production

**Security Improvements Applied:**
- httpOnly cookies prevent XSS token theft (tokens not accessible to JavaScript)
- Automatic token refresh keeps sessions alive without re-authentication
- CSRF protection via OAuth state parameter validation
- SameSite cookie attribute for additional CSRF protection

### Phase 5: Polish ✅ **COMPLETE** — [PR #8](https://github.com/jpshackelford/voice-relay/pull/8) 🎉 FINAL PHASE

**This completes the Voice Relay platform implementation.**

- [x] Device tokens for reconnection (persist device identity across page refreshes)
  - Migration 005 adds `devices` table with SHA-256 hashed tokens
  - Migration 006 removes plaintext storage, adds 30-day token expiration
  - DeviceRepository for token validation and device management
  - Client-side localStorage persistence with deviceToken.ts
- [x] Session tracking (multiple sessions per workspace)
  - Migration 005 adds `sessions` and `session_devices` tables
  - SessionRepository with lifecycle management (active/ended/archived)
  - Session summaries with device counts
- [x] QR code improvements (join codes, deep linking)
  - QRCode component enhanced with joinCode and workspaceId props
  - JoinCodeInput component for manual code entry
  - Deep linking support (/workspace/{id}?session={sessionId})
- [x] Error handling and validation (user-friendly error messages)
  - errors.ts utility with getUserFriendlyMessage()
  - Network error mapping and API error parsing
- [x] Proactive token refresh (check expiry before making requests)
  - AuthContext.ensureValidToken() checks 5-min threshold
  - Prevents 401 errors by refreshing before API calls
- [x] Loading states and optimistic UI updates
  - CSS spinner animations and skeleton loading
  - Toast notification styles
  - Reconnect banner for device session restoration
- [x] Security hardening (from code review feedback)
  - Hash-only token storage (plaintext removed)
  - Rate limiting on validation endpoint (10 req/min/IP)
  - Token expiration with 30-day TTL and auto-renewal
- [x] Comprehensive test coverage
  - 300 tests (261 server + 39 client)
  - Router integration tests for devices/sessions
  - Client utility tests for deviceToken/errors

**Learnings from Phase 5:**
- SQLite ALTER TABLE is limited; migration handles column addition with proper fallback
- Device tokens use SHA-256 hashing (one-way) vs. encryption for better security
- localStorage is sufficient for device token persistence; IndexedDB adds complexity without benefit
- Proactive token refresh threshold (5 min) balances UX vs. network overhead

**Security Hardening (PR #8 Review):**
- **Never store plaintext tokens**: Only store hashes; return token once at creation, never persist in plaintext
- **Public endpoints need rate limiting**: Token validation endpoint exposed to brute-force; added 10 req/min/IP limit
- **Tokens need expiration**: 30-day TTL with automatic renewal on use; prevents indefinite access from lost devices
- **SQLite compatibility**: Document backup/recreate pattern for migrations on pre-3.35.0 SQLite (no DROP COLUMN support)
- **Extract complex hooks**: `useDeviceRestoration` improves testability over inline useEffect with multiple concerns

**Future Enhancements (if needed):**
- E2E tests for device persistence across page refresh
- Client-side session switching UI
- Full integration of session history per session

---

## Project Completion Summary

All 5 phases are now complete:

| Phase | Description | PR |
|-------|-------------|------|
| Phase 1 | Database Layer | [PR #1](https://github.com/jpshackelford/voice-relay/pull/1) |
| Phase 2 | Authentication (GitHub OAuth) | [PR #2](https://github.com/jpshackelford/voice-relay/pull/2) |
| Phase 3 | Workspaces | [PR #3](https://github.com/jpshackelford/voice-relay/pull/3) |
| Phase 3.5 | Device Registry & WebSocket | [PR #5](https://github.com/jpshackelford/voice-relay/pull/5) |
| Phase 4 | UI & Auth Integration | [PR #6](https://github.com/jpshackelford/voice-relay/pull/6) |
| Phase 5 | Polish (Device Persistence, Sessions, Security) | [PR #8](https://github.com/jpshackelford/voice-relay/pull/8) |

**Key Learnings Across All Phases:**
1. **Incremental migrations**: Building schema progressively allows for safer production deployments
2. **Security review is essential**: Code review caught critical security issues (plaintext tokens, missing rate limiting)
3. **SQLite compatibility matters**: Production may use older versions; use backup/recreate patterns for DDL changes
4. **Test coverage pays off**: 300+ tests provide confidence in refactoring and deployment
5. **Hook extraction improves testability**: Complex React effects should be extracted to custom hooks

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
