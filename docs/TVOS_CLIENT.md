# tvOS Client Integration Guide

This document describes the server-side features and protocols that a tvOS (Apple TV) client should use to integrate with the voice-relay server.

## Overview

The voice-relay server supports native tvOS clients through:

1. **Device Authorization Grant Flow** - OAuth authentication without browser redirects
2. **WebSocket Protocol** - Real-time communication with the server
3. **Display API** - Optional HTTP endpoint for direct display updates
4. **Platform Identification** - Analytics and debugging support

## Authentication

### Device Authorization Grant Flow (RFC 8628)

Since tvOS apps cannot easily handle browser-based OAuth redirects, the server implements the OAuth 2.0 Device Authorization Grant flow. This allows users to authenticate on a secondary device (phone/computer) while the TV displays a simple code.

#### Flow Overview

```
┌─────────────────┐                              ┌─────────────────┐
│   Apple TV      │                              │    Server       │
│   (tvOS App)    │                              │                 │
└────────┬────────┘                              └────────┬────────┘
         │                                                │
         │  1. POST /auth/device/code                     │
         │ ─────────────────────────────────────────────► │
         │                                                │
         │  {device_code, user_code, verification_uri}    │
         │ ◄───────────────────────────────────────────── │
         │                                                │
         │  2. Display user_code and verification_uri     │
         │     on screen for user                         │
         │                                                │
         │  3. Poll: POST /auth/device/token              │
         │     (every 5 seconds)                          │
         │ ─────────────────────────────────────────────► │
         │                                                │
         │  "authorization_pending" (keep polling)        │
         │ ◄───────────────────────────────────────────── │
         │                                                │
         │         [User enters code on phone/computer]   │
         │         [User completes GitHub OAuth]          │
         │                                                │
         │  4. Poll: POST /auth/device/token              │
         │ ─────────────────────────────────────────────► │
         │                                                │
         │  {access_token, refresh_token}                 │
         │ ◄───────────────────────────────────────────── │
         │                                                │
         │  5. Connect WebSocket with token               │
         │                                                │
```

#### API Endpoints

##### POST /auth/device/code

Request a new device/user code pair.

**Request:**
```http
POST /auth/device/code
Content-Type: application/json
```

**Response:**
```json
{
  "device_code": "a1b2c3d4e5f6...",
  "user_code": "ABCD-1234",
  "verification_uri": "https://example.com/auth/device/verify",
  "verification_uri_complete": "https://example.com/auth/device/verify?code=ABCD-1234",
  "expires_in": 900,
  "interval": 5
}
```

Display to the user:
1. **QR Code** - Encode `verification_uri_complete` as a QR code (recommended - users can scan with phone camera)
2. **User Code** - Show `user_code` prominently (e.g., "ABCD-1234")
3. **Fallback URL** - Show `verification_uri` as text for manual entry

**Example tvOS UI:**
```
┌─────────────────────────────────────────┐
│                                         │
│         Scan to Connect                 │
│                                         │
│          ┌─────────────┐                │
│          │ [QR CODE]   │                │
│          │             │                │
│          └─────────────┘                │
│                                         │
│    Or visit: example.com/auth/device    │
│    Enter code: ABCD-1234                │
│                                         │
└─────────────────────────────────────────┘
```

##### POST /auth/device/token

Poll for access token using the device code.

**Request:**
```http
POST /auth/device/token
Content-Type: application/json

{
  "device_code": "a1b2c3d4e5f6..."
}
```

**Responses:**

- **Success (200):**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "refresh_token": "eyJhbGciOiJIUzI1NiIs...",
  "token_type": "Bearer",
  "expires_in": 604800
}
```

- **Pending (400):**
```json
{
  "error": "authorization_pending",
  "error_description": "The user has not yet completed authorization. Continue polling."
}
```

- **Slow Down (400):**
```json
{
  "error": "slow_down",
  "error_description": "Please wait at least 5 seconds between polling requests"
}
```

- **Expired (400):**
```json
{
  "error": "expired_token",
  "error_description": "The device code has expired. Please request a new code."
}
```

- **Denied (400):**
```json
{
  "error": "access_denied",
  "error_description": "The user denied the authorization request."
}
```

### Token Storage

Store tokens securely in the tvOS Keychain:
- `access_token` - Used for API requests and WebSocket auth
- `refresh_token` - Used to get new access tokens when they expire

### Token Refresh

When the access token expires, use the refresh token:

```http
POST /auth/refresh
Cookie: voice_relay_refresh=<refresh_token>
```

**Note:** For tvOS clients not using cookies, you may need to pass the refresh token in a different way. Contact maintainers if you need an alternative refresh mechanism.

---

## WebSocket Protocol

### Connection

Connect to the WebSocket endpoint:

```
wss://example.com/ws
```

### Registration

After connecting, register the device:

```json
{
  "type": "register",
  "deviceId": "unique-device-uuid",
  "workspaceId": "workspace-uuid",
  "sessionId": "session-uuid",
  "displayName": "Living Room TV",
  "mode": "kiosk",
  "screenWidth": 1920,
  "screenHeight": 1080,
  "platform": "tvos"
}
```

#### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | ✅ | Must be `"register"` |
| `deviceId` | string | ✅ | Unique device identifier (UUID, persist across sessions) |
| `workspaceId` | string | ❌ | Workspace to join (defaults to `"default"`) |
| `sessionId` | string | ❌ | Specific session to join (auto-assigned if omitted) |
| `displayName` | string | ✅ | User-visible device name |
| `mode` | string | ✅ | `"kiosk"` for TV displays |
| `screenWidth` | number | ❌ | Screen width in pixels (for display line calculation) |
| `screenHeight` | number | ❌ | Screen height in pixels |
| `platform` | string | ❌ | `"tvos"` for Apple TV |

### Server Messages

#### `registered`
Confirms successful registration:
```json
{
  "type": "registered",
  "deviceId": "device-uuid",
  "session": {
    "id": "session-uuid",
    "name": "Session Name"
  },
  "deviceToken": "token-for-reconnection",
  "tokenExpiresAt": "2024-12-01T00:00:00Z"
}
```

#### `display`
Content to show on the kiosk display:
```json
{
  "type": "display",
  "display": {
    "type": "markdown",
    "content": "# Welcome\n\nThis is **markdown** content.",
    "title": "Optional Title"
  }
}
```

Display types:
- `markdown` - Markdown content to render
- `image` - Image URL to display
- `clear` - Clear the display

#### `text`
Message from another device in the session:
```json
{
  "type": "text",
  "utteranceId": "unique-utterance-id",
  "workspaceId": "workspace-uuid",
  "sessionId": "session-uuid",
  "senderId": "device-id",
  "senderName": "John's iPhone",
  "text": "Hello from my phone!",
  "partial": false
}
```

#### `history`
Message history when joining a session:
```json
{
  "type": "history",
  "messages": [
    { "type": "text", "text": "...", ... }
  ]
}
```

#### `ai-thinking`
AI is processing a response:
```json
{
  "type": "ai-thinking",
  "sessionId": "session-uuid",
  "thinking": true
}
```

#### `session-ai-status`
AI connection status for the session:
```json
{
  "type": "session-ai-status",
  "sessionId": "session-uuid",
  "connected": true,
  "conversationId": "conv-uuid"
}
```

#### `device-list`
List of devices in the workspace:
```json
{
  "type": "device-list",
  "devices": [
    {
      "id": "device-uuid",
      "workspaceId": "workspace-uuid",
      "displayName": "Living Room TV",
      "mode": "kiosk"
    }
  ]
}
```

#### `join-request`
User requesting to join the workspace (for owner approval):
```json
{
  "type": "join-request",
  "request": {
    "id": "request-uuid",
    "workspaceId": "workspace-uuid",
    "user": {
      "id": "user-uuid",
      "username": "johndoe",
      "displayName": "John Doe",
      "avatarUrl": "https://..."
    },
    "createdAt": "2024-01-01T00:00:00Z"
  }
}
```

### Client Messages

#### `text`
Send a text message:
```json
{
  "type": "text",
  "utteranceId": "unique-id",
  "text": "Hello!",
  "partial": false
}
```

#### `join-response`
Respond to a join request (owner only):
```json
{
  "type": "join-response",
  "requestId": "request-uuid",
  "approved": true
}
```

#### `update-device`
Update device settings:
```json
{
  "type": "update-device",
  "displayName": "New Name",
  "mode": "kiosk",
  "ttsEnabled": true
}
```

---

## Reconnection Strategy

tvOS apps may be suspended when not in the foreground. Implement reconnection:

1. **On foreground transition:**
   - Check if WebSocket is connected
   - If not, reconnect and re-register with same `deviceId`

2. **Exponential backoff:**
   - Start with 1 second delay
   - Double delay on each failure (max 30 seconds)
   - Reset delay on successful connection

3. **Token refresh:**
   - Before reconnecting, check if access token is expired
   - If expired, use refresh token to get new tokens
   - If refresh fails, restart device authorization flow

---

## Display Rendering

### Markdown Support

Use a Swift markdown library like [MarkdownUI](https://github.com/gonzalezreal/swift-markdown-ui) for rendering:

```swift
import MarkdownUI

struct DisplayView: View {
    let content: String
    
    var body: some View {
        ScrollView {
            Markdown(content)
                .padding()
        }
    }
}
```

### Images

Images in display content are provided as URLs. Load them using standard `AsyncImage`:

```swift
if displayType == "image", let url = URL(string: content) {
    AsyncImage(url: url) { image in
        image.resizable().aspectRatio(contentMode: .fit)
    } placeholder: {
        ProgressView()
    }
}
```

---

## Focus Navigation

tvOS uses focus-based navigation with the Siri Remote. Ensure all interactive elements are focusable:

```swift
Button("Approve") { /* action */ }
    .focusable()

// For custom focus handling
@FocusState private var focusedField: Field?
```

---

## QR Code Generation

tvOS supports generating QR codes using Core Image. Display the `verification_uri_complete` as a QR code:

```swift
import CoreImage.CIFilterBuiltins
import SwiftUI

struct QRCodeView: View {
    let url: String
    
    var body: some View {
        if let image = generateQRCode(from: url) {
            Image(uiImage: image)
                .interpolation(.none)
                .resizable()
                .scaledToFit()
                .frame(width: 300, height: 300)
        }
    }
    
    private func generateQRCode(from string: String) -> UIImage? {
        let context = CIContext()
        let filter = CIFilter.qrCodeGenerator()
        
        filter.message = Data(string.utf8)
        filter.correctionLevel = "M"
        
        guard let outputImage = filter.outputImage else { return nil }
        
        // Scale up for TV display
        let scale = 10.0
        let scaledImage = outputImage.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
        
        guard let cgImage = context.createCGImage(scaledImage, from: scaledImage.extent) else {
            return nil
        }
        
        return UIImage(cgImage: cgImage)
    }
}

// Usage in device auth flow:
struct DeviceAuthView: View {
    let deviceCode: DeviceCodeResponse
    
    var body: some View {
        VStack(spacing: 40) {
            Text("Scan to Connect")
                .font(.title)
            
            QRCodeView(url: deviceCode.verification_uri_complete)
            
            Text("Or enter code:")
                .font(.headline)
            
            Text(deviceCode.user_code)
                .font(.system(size: 48, weight: .bold, design: .monospaced))
            
            Text("at \(deviceCode.verification_uri)")
                .font(.subheadline)
                .foregroundColor(.secondary)
        }
    }
}
```

---

## Example: Minimal tvOS Client

```swift
import SwiftUI
import Combine

class VoiceRelayClient: ObservableObject {
    @Published var connected = false
    @Published var displayContent: DisplayContent?
    @Published var messages: [TextMessage] = []
    
    private var webSocket: URLSessionWebSocketTask?
    private var accessToken: String?
    
    func connect(token: String, workspaceId: String) {
        self.accessToken = token
        
        let url = URL(string: "wss://example.com/ws")!
        webSocket = URLSession.shared.webSocketTask(with: url)
        webSocket?.resume()
        
        // Register after connection
        let register = RegisterMessage(
            deviceId: getDeviceId(),
            workspaceId: workspaceId,
            displayName: "Apple TV",
            mode: "kiosk",
            platform: "tvos"
        )
        send(register)
        
        // Start receiving messages
        receiveMessage()
    }
    
    private func receiveMessage() {
        webSocket?.receive { [weak self] result in
            switch result {
            case .success(.string(let text)):
                self?.handleMessage(text)
            case .failure(let error):
                print("WebSocket error: \(error)")
                self?.reconnect()
            default:
                break
            }
            // Continue receiving
            self?.receiveMessage()
        }
    }
    
    private func handleMessage(_ text: String) {
        // Parse JSON and update state
        // ...
    }
}
```

---

## Security Considerations

1. **Token Storage:** Store tokens in the iOS/tvOS Keychain, not UserDefaults
2. **TLS:** Always use `wss://` for WebSocket connections
3. **Device ID:** Use a persistent UUID stored in Keychain
4. **Sensitive Data:** Don't log tokens or sensitive content

---

## Testing

### Simulator

Test in the tvOS Simulator using Xcode. The WebSocket and HTTP clients work normally.

### Device Testing

For on-device testing:
1. Enable developer mode on Apple TV
2. Pair with Xcode
3. Deploy and test with real network conditions

---

## References

- [RFC 8628 - Device Authorization Grant](https://datatracker.ietf.org/doc/html/rfc8628)
- [Apple tvOS Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/tvos)
- [URLSessionWebSocketTask](https://developer.apple.com/documentation/foundation/urlsessionwebsockettask)
- [MarkdownUI Swift Package](https://github.com/gonzalezreal/swift-markdown-ui)
