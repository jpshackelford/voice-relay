# Migration Guide

This document covers breaking changes and migration steps for Voice Relay upgrades.

## Phase 4: Authentication & Authorization

**Release:** PR #6 - feat(client): add auth UI and dashboard for workspace management

### Breaking Changes

#### 1. Authentication Required
All routes now require GitHub OAuth authentication. Users must sign in with GitHub to access the application.

**Before:** Direct access to any URL without authentication.
**After:** Unauthenticated requests redirect to `/login`.

#### 2. WebSocket Protocol Change
The WebSocket `register` message now requires a `workspaceId` field.

**Before:**
```json
{
  "type": "register",
  "deviceId": "device-123",
  "displayName": "My Device",
  "mode": "mobile"
}
```

**After:**
```json
{
  "type": "register",
  "deviceId": "device-123",
  "displayName": "My Device",
  "mode": "mobile",
  "workspaceId": "workspace-uuid"
}
```

**Note:** For backward compatibility, if `workspaceId` is omitted, it defaults to `'default'`. However, this workspace may not exist in authenticated deployments.

#### 3. Display API Change
The `/api/display` endpoint now requires a `workspaceId` field.

**Before:**
```json
{
  "type": "markdown",
  "content": "# Hello World"
}
```

**After:**
```json
{
  "type": "markdown",
  "content": "# Hello World",
  "workspaceId": "workspace-uuid"
}
```

### Migration Steps

#### For Deployment Admins

1. **Configure GitHub OAuth**
   - Create a GitHub OAuth App at https://github.com/settings/developers
   - Set Authorization callback URL to: `https://your-domain.com/auth/github/callback`
   - Note the Client ID and generate a Client Secret

2. **Set Environment Variables**
   ```bash
   # Required for authentication
   GITHUB_CLIENT_ID=your-github-client-id
   GITHUB_CLIENT_SECRET=your-github-client-secret
   JWT_SECRET=your-secure-random-secret
   
   # Optional
   JWT_EXPIRES_IN=7d    # Token expiration (default: 7d)
   BASE_URL=https://your-domain.com  # For OAuth callback URL
   ```

3. **Run Database Migrations**
   Migrations run automatically on server start. The following migrations will be applied:
   - `005_users.sql`: Creates users table for GitHub accounts
   - `006_workspace_members.sql`: Creates workspace membership table

4. **Verify Migration**
   - Start the server
   - Navigate to your application URL
   - You should be redirected to the login page
   - Sign in with GitHub
   - Create a new workspace from the dashboard

#### For API Integrations

1. **Update Display API Calls**
   Add `workspaceId` to all `/api/display` requests:
   ```javascript
   await fetch('/api/display', {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({
       type: 'markdown',
       content: '# Hello',
       workspaceId: 'your-workspace-id'
     })
   });
   ```

2. **Update WebSocket Connections**
   Include `workspaceId` when registering devices:
   ```javascript
   ws.send(JSON.stringify({
     type: 'register',
     deviceId: 'device-123',
     displayName: 'AI Agent',
     mode: 'mobile',
     workspaceId: 'your-workspace-id'
   }));
   ```

3. **Obtain Workspace ID**
   Workspace IDs can be found in:
   - The URL when viewing a workspace: `/workspace/{workspaceId}`
   - The dashboard workspace list (API: `GET /api/workspaces`)

#### For Existing Deployments

If you have an existing deployment with data:

1. **Existing Messages**
   Migration `004_workspace_scoping.sql` assigns existing messages to a 'default' workspace.
   After upgrading, create a workspace and note its ID for future use.

2. **Session Data**
   Session storage is workspace-scoped. Existing sessions will continue to work
   with the 'default' workspace ID, but new features require proper workspace assignment.

### Security Improvements in Phase 4

1. **httpOnly Cookies**: JWT tokens are now stored in httpOnly cookies instead of URL parameters or localStorage. This prevents XSS token theft.

2. **Token Refresh**: Automatic token refresh keeps sessions active without re-authentication. Refresh tokens are stored in httpOnly cookies.

3. **CSRF Protection**: OAuth state parameter validation prevents CSRF attacks during authentication.

### Rollback Procedure

If you need to rollback:

1. **Restore Environment**
   Remove the GitHub OAuth environment variables to disable authentication:
   ```bash
   unset GITHUB_CLIENT_ID
   unset GITHUB_CLIENT_SECRET
   unset JWT_SECRET
   ```

2. **Database State**
   Migrations are forward-only. To fully rollback, restore from a database backup taken before the upgrade.

### Troubleshooting

#### "401 Unauthorized" on all requests
- Verify GitHub OAuth credentials are set correctly
- Check that cookies are being sent (credentials: 'include' in fetch)
- Clear browser cookies and re-authenticate

#### "Invalid or expired token"
- Token may have expired; page refresh will trigger re-authentication
- Check JWT_EXPIRES_IN setting is appropriate

#### "Workspace not found" when connecting
- Ensure the workspaceId exists and user has access
- Check workspace membership via dashboard
- Use the join code to add user to workspace

#### WebSocket connection fails
- Verify workspaceId is provided in register message
- Check that the workspace exists and user has access
- Server logs will show workspace validation errors

### Support

For migration assistance, open an issue at:
https://github.com/jpshackelford/voice-relay/issues
