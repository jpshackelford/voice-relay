import type { WebSocket } from 'ws';
import type { Device, DeviceInfo, DeviceMode, DevicePlatform, RelayedTextMessage, DeviceListMessage, DisplayMessage, DisplayContent, AudioChunkMessage, AudioEndMessage } from './types.js';

// Display calculation constants (from CSS)
const DISPLAY_PADDING_PX = 96;      // 3rem * 2 = 48px * 2
const DISPLAY_TITLE_HEIGHT_PX = 72; // title font-size + margin
const LINE_HEIGHT_PX = 45;          // 1.75rem * 1.6 line-height ≈ 45px
const SIDEBAR_RATIO = 0.382;        // Golden ratio sidebar

/**
 * Calculate maximum displayable lines for a kiosk screen.
 *
 * @param screenWidth - Kiosk display width in CSS pixels
 * @param screenHeight - Kiosk display height in CSS pixels
 * @param tickersEnabled - True when the workspace has the new footer ticker
 *   strips enabled (issue #340). The strips eat ~1 line of body content; we
 *   subtract one full `LINE_HEIGHT_PX` so the OpenHands `Maximum N lines`
 *   prompt stays honest even though the strips are slightly under one line tall.
 */
export function calculateDisplayLines(
  screenWidth: number,
  screenHeight: number,
  tickersEnabled = false
): number {
  // Kiosk display takes remaining space after sidebar
  // Available height = screenHeight - padding - title - optional ticker row
  const tickerReserved = tickersEnabled ? LINE_HEIGHT_PX : 0;
  const availableHeight = screenHeight - DISPLAY_PADDING_PX - DISPLAY_TITLE_HEIGHT_PX - tickerReserved;
  const lines = Math.floor(availableHeight / LINE_HEIGHT_PX);
  // Minimum 5 lines, maximum 30 lines (sanity bounds)
  return Math.max(5, Math.min(30, lines));
}

/**
 * Per-kiosk picker enrichment (issue #393). Populated by the consumer
 * (`index.ts`) so the registry stays DB-free. When set,
 * `broadcastDeviceList` hydrates kiosk entries with their active session
 * anchor and last-used timestamp before broadcasting.
 */
export type KioskPickerEnricher = (
  workspaceId: string
) => Map<string, { activeSessionId: string | null; lastUsedAt: string | null }>;

export class DeviceRegistry {
  private devices = new Map<string, Device>();
  private kioskEnricher: KioskPickerEnricher | null = null;

  /**
   * Install the kiosk picker enrichment callback. Issue #393.
   *
   * The caller passes `(workspaceId) => Map<deviceId, {activeSessionId,
   * lastUsedAt}>` (typically backed by
   * `SessionRepository.getKioskPickerEnrichment`). Subsequent
   * `broadcastDeviceList` calls use it to enrich kiosk entries.
   *
   * Calling with `null` clears the hook — used by tests.
   */
  setKioskEnricher(enricher: KioskPickerEnricher | null): void {
    this.kioskEnricher = enricher;
  }

  register(
    id: string, 
    workspaceId: string,
    ws: WebSocket, 
    displayName: string, 
    mode: DeviceMode,
    screenWidth?: number,
    screenHeight?: number,
    sessionId?: string,
    platform?: DevicePlatform,
    tickersEnabled?: boolean,
    timezone?: string,
    tzOffsetMinutes?: number,
    primaryUserId?: string | null,
  ): Device {
    const existing = this.devices.get(id);
    if (existing) {
      // Reconnection: update WebSocket reference, workspace, session, and screen info
      existing.ws = ws;
      existing.workspaceId = workspaceId;
      existing.sessionId = sessionId;
      existing.displayName = displayName;
      existing.mode = mode;
      if (platform) existing.platform = platform;
      // Issue #375: refresh the speaker's timezone metadata on reconnect.
      // A device crossing timezones (mobile traveler) sends a new value;
      // we overwrite. Clients that omit the field keep the prior value.
      if (timezone !== undefined) existing.timezone = timezone;
      if (tzOffsetMinutes !== undefined) existing.tzOffsetMinutes = tzOffsetMinutes;
      // Issue #383: refresh cached primaryUserId on reconnect. The caller
      // re-reads `devices.primary_user_id` from the DB, so this picks up
      // any claim/clear that happened while the device was offline.
      if (primaryUserId !== undefined) existing.primaryUserId = primaryUserId;
      // Only track screen dimensions for kiosk devices (they have the display)
      if (mode === 'kiosk') {
        if (screenWidth) existing.screenWidth = screenWidth;
        if (screenHeight) existing.screenHeight = screenHeight;
        if (screenWidth && screenHeight) {
          existing.displayLines = calculateDisplayLines(screenWidth, screenHeight, tickersEnabled);
        }
        const platformStr = platform ? ` [${platform}]` : '';
        console.log(`[Registry] Kiosk reconnected: ${displayName} (${id})${platformStr} in workspace ${workspaceId}, session ${sessionId || 'none'}, ${existing.displayLines || '?'} display lines`);
      } else {
        const platformStr = platform ? ` [${platform}]` : '';
        console.log(`[Registry] Device reconnected: ${displayName} (${id})${platformStr} as ${mode} in workspace ${workspaceId}, session ${sessionId || 'none'}`);
      }
      return existing;
    }

    // Only calculate displayLines for kiosk devices - mobile/other devices are voice-only
    const displayLines = (mode === 'kiosk' && screenWidth && screenHeight) 
      ? calculateDisplayLines(screenWidth, screenHeight, tickersEnabled)
      : undefined;

    const device: Device = {
      id,
      workspaceId,
      sessionId,
      displayName,
      mode,
      ws,
      connectedAt: new Date(),
      screenWidth: mode === 'kiosk' ? screenWidth : undefined,
      screenHeight: mode === 'kiosk' ? screenHeight : undefined,
      displayLines,
      platform,
      // Issue #375: persist registration-time timezone metadata for use by
      // the OpenHands per-turn header and peer-message rendering.
      timezone,
      tzOffsetMinutes,
      // Issue #383: cache `devices.primary_user_id` so per-utterance speaker
      // resolution doesn't need to re-query the DB. Refreshed on reconnect
      // and via DeviceRegistry.updateDevice when a user (re)claims the device.
      primaryUserId,
    };
    this.devices.set(id, device);
    
    if (mode === 'kiosk') {
      const platformStr = platform ? ` [${platform}]` : '';
      console.log(`[Registry] Kiosk registered: ${displayName} (${id})${platformStr} in workspace ${workspaceId}, session ${sessionId || 'none'}, ${displayLines || '?'} display lines`);
    } else {
      const platformStr = platform ? ` [${platform}]` : '';
      console.log(`[Registry] Device registered: ${displayName} (${id})${platformStr} as ${mode} in workspace ${workspaceId}, session ${sessionId || 'none'}`);
    }
    return device;
  }

  updateDevice(
    id: string,
    updates: Partial<Pick<Device, 'displayName' | 'mode' | 'ttsEnabled' | 'primaryUserId'>>
  ): Device | null {
    const device = this.devices.get(id);
    if (!device) return null;

    if (updates.displayName !== undefined) device.displayName = updates.displayName;
    if (updates.mode !== undefined) device.mode = updates.mode;
    if (updates.ttsEnabled !== undefined) device.ttsEnabled = updates.ttsEnabled;
    // Issue #383: keep the cached primaryUserId in sync when a workspace
    // member (re)claims the device via the PATCH endpoint, so the very next
    // utterance is stamped with the correct speaker without a DB lookup.
    if (updates.primaryUserId !== undefined) device.primaryUserId = updates.primaryUserId;

    console.log(`[Registry] Device updated: ${device.displayName} (${id})`);
    return device;
  }

  /**
   * Issue #388: record the device's current mic listening state.
   *
   * Both fields are transient runtime-only — they live on the in-memory
   * `Device` record and are never persisted to SQLite. The caller is
   * expected to call `broadcastDeviceList(device.workspaceId)` afterward
   * so every peer in the workspace observes the new aggregate via the
   * existing `device-list` payload.
   *
   * Returns the mutated device for chaining; `null` if the id is unknown
   * (e.g. a `device-listening-state` arrived before `register` — that
   * happens on flaky reconnects and is a benign no-op).
   */
  setListeningState(
    id: string,
    listening: boolean,
    sttSupported: boolean,
  ): Device | null {
    const device = this.devices.get(id);
    if (!device) return null;
    device.listening = listening;
    device.sttSupported = sttSupported;
    return device;
  }

  disconnect(id: string): void {
    const device = this.devices.get(id);
    if (device) {
      console.log(`[Registry] Device disconnected: ${device.displayName} (${id})`);
      this.devices.delete(id);
    }
  }

  disconnectBySocket(ws: WebSocket): string | null {
    for (const [id, device] of this.devices) {
      if (device.ws === ws) {
        this.disconnect(id);
        return id;
      }
    }
    return null;
  }

  getDevice(id: string): Device | undefined {
    return this.devices.get(id);
  }

  // --- Workspace-scoped queries ---

  /**
   * Get all devices in a specific workspace.
   */
  getDevicesByWorkspace(workspaceId: string): Device[] {
    return [...this.devices.values()].filter(d => d.workspaceId === workspaceId);
  }

  /**
   * Get all devices in a specific session.
   */
  getDevicesBySession(sessionId: string): Device[] {
    return [...this.devices.values()].filter(d => d.sessionId === sessionId);
  }

  getMobileDevices(workspaceId?: string): Device[] {
    const devices = workspaceId 
      ? this.getDevicesByWorkspace(workspaceId) 
      : [...this.devices.values()];
    return devices.filter(d => d.mode === 'mobile');
  }

  getKioskDevices(workspaceId?: string): Device[] {
    const devices = workspaceId 
      ? this.getDevicesByWorkspace(workspaceId) 
      : [...this.devices.values()];
    return devices.filter(d => d.mode === 'kiosk');
  }

  getReceivingDevices(workspaceId?: string): Device[] {
    // All devices can receive messages (both mobile and kiosk)
    return workspaceId 
      ? this.getDevicesByWorkspace(workspaceId) 
      : [...this.devices.values()];
  }

  /**
   * Get the minimum display lines across kiosk devices in a workspace.
   * Returns undefined if no kiosk devices have screen info.
   * This is the safe maximum to use for content that must fit all screens.
   */
  getMinKioskDisplayLines(workspaceId?: string): number | undefined {
    const kioskDevices = this.getKioskDevices(workspaceId);
    const linesArray = kioskDevices
      .map(d => d.displayLines)
      .filter((lines): lines is number => lines !== undefined);
    
    if (linesArray.length === 0) return undefined;
    return Math.min(...linesArray);
  }

  canSend(device: Device): boolean {
    // All devices can send (both mobile and kiosk)
    return true;
  }

  canReceive(device: Device): boolean {
    // All devices can receive (both mobile and kiosk)
    return true;
  }

  getAllDevices(): Device[] {
    return [...this.devices.values()];
  }

  getDeviceList(workspaceId?: string): DeviceInfo[] {
    const devices = workspaceId 
      ? this.getDevicesByWorkspace(workspaceId) 
      : this.getAllDevices();
    return devices.map(d => ({
      id: d.id,
      workspaceId: d.workspaceId,
      displayName: d.displayName,
      mode: d.mode,
    }));
  }

  /**
   * Broadcast a text message to all devices in a workspace.
   */
  broadcastToOutputs(message: RelayedTextMessage, workspaceId: string, excludeId?: string): void {
    const receivers = this.getReceivingDevices(workspaceId);
    const payload = JSON.stringify(message);

    for (const device of receivers) {
      if (device.id !== excludeId && device.ws.readyState === device.ws.OPEN) {
        device.ws.send(payload);
      }
    }
  }

  /**
   * Broadcast a text message to all devices in a session.
   */
  broadcastToSession(message: RelayedTextMessage, sessionId: string, excludeId?: string): void {
    const receivers = this.getDevicesBySession(sessionId);
    const payload = JSON.stringify(message);

    for (const device of receivers) {
      if (device.id !== excludeId && device.ws.readyState === device.ws.OPEN) {
        device.ws.send(payload);
      }
    }
  }

  /**
   * Broadcast any server message to all devices in a session.
   * Use for status messages, AI updates, etc.
   */
  broadcastMessageToSession(sessionId: string, message: object, excludeId?: string): void {
    const receivers = this.getDevicesBySession(sessionId);
    const payload = JSON.stringify(message);

    for (const device of receivers) {
      if (device.id !== excludeId && device.ws.readyState === device.ws.OPEN) {
        device.ws.send(payload);
      }
    }
  }

  /**
   * Broadcast the device list to all devices in a workspace.
   * Each device only sees devices in their own workspace.
   */
  broadcastDeviceList(workspaceId: string): void {
    const devicesInWorkspace = this.getDevicesByWorkspace(workspaceId);
    // Issue #393: enrich kiosk entries with the active session anchor
    // and last-used timestamp so the mobile kiosk picker can render
    // status pills and "last used 2h ago" on first paint. Enricher is
    // optional — anonymous mode and unit tests skip the DB hit entirely.
    const enrichment = this.kioskEnricher?.(workspaceId);
    const deviceList: DeviceInfo[] = devicesInWorkspace.map(d => {
      const base: DeviceInfo = {
        id: d.id,
        workspaceId: d.workspaceId,
        displayName: d.displayName,
        mode: d.mode,
      };
      if (d.mode === 'kiosk' && enrichment) {
        const extra = enrichment.get(d.id);
        base.activeSessionId = extra?.activeSessionId ?? null;
        base.lastUsedAt = extra?.lastUsedAt ?? null;
      }
      // Issue #388: surface the per-device mic listening state on the
      // existing device-list payload so the kiosk can derive the
      // three-state indicator (listening / muted / no-mic) without a
      // separate broadcast. Both fields stay `undefined` for clients that
      // haven't sent `device-listening-state` yet; the kiosk treats
      // `undefined` conservatively as "not mic-capable".
      if (d.listening !== undefined) base.listening = d.listening;
      if (d.sttSupported !== undefined) base.sttSupported = d.sttSupported;
      return base;
    });

    const message: DeviceListMessage = {
      type: 'device-list',
      devices: deviceList,
    };
    const payload = JSON.stringify(message);

    for (const device of devicesInWorkspace) {
      if (device.ws.readyState === device.ws.OPEN) {
        device.ws.send(payload);
      }
    }
  }

  /**
   * Broadcast display content to all kiosk devices in a specific workspace.
   * Use broadcastToAllKiosks() for intentional global broadcasts.
   */
  broadcastToKiosks(displayContent: DisplayContent, workspaceId: string): void {
    const message: DisplayMessage = {
      type: 'display',
      display: displayContent,
    };
    const payload = JSON.stringify(message);

    for (const device of this.getKioskDevices(workspaceId)) {
      if (device.ws.readyState === device.ws.OPEN) {
        device.ws.send(payload);
      }
    }
  }

  /**
   * Broadcast display content to ALL kiosk devices across all workspaces.
   * Use with caution - this intentionally bypasses workspace isolation.
   * For workspace-scoped broadcasts, use broadcastToKiosks() instead.
   */
  broadcastToAllKiosks(displayContent: DisplayContent): void {
    const message: DisplayMessage = {
      type: 'display',
      display: displayContent,
    };
    const payload = JSON.stringify(message);

    for (const device of this.getKioskDevices()) {
      if (device.ws.readyState === device.ws.OPEN) {
        device.ws.send(payload);
      }
    }
  }

  sendToDevice(deviceId: string, message: object): boolean {
    const device = this.devices.get(deviceId);
    if (!device || device.ws.readyState !== device.ws.OPEN) {
      return false;
    }
    device.ws.send(JSON.stringify(message));
    return true;
  }

  /**
   * Disconnect all devices in a workspace.
   * Sends a workspace-deleted message and closes WebSocket connections.
   * Returns the number of devices disconnected.
   */
  disconnectWorkspaceDevices(workspaceId: string, reason?: string): number {
    const devices = this.getDevicesByWorkspace(workspaceId);
    const message = { type: 'workspace-deleted', reason };
    const payload = JSON.stringify(message);
    let disconnectedCount = 0;

    for (const device of devices) {
      try {
        if (device.ws.readyState === device.ws.OPEN) {
          device.ws.send(payload);
          device.ws.close(1000, 'Workspace deleted');
        }
        disconnectedCount++;
      } catch (err) {
        console.error(`[Registry] Error disconnecting device ${device.id}:`, err);
      }
      // Always remove from registry, even if notification failed.
      // Devices that couldn't be notified will eventually timeout/disconnect naturally.
      this.devices.delete(device.id);
    }

    if (disconnectedCount > 0) {
      console.log(`[Registry] Disconnected ${disconnectedCount} devices from workspace ${workspaceId}`);
    }

    return disconnectedCount;
  }

  /**
   * Broadcast audio message to kiosk devices in a session.
   * Used for TTS audio streaming - only kiosks play audio to avoid echo.
   * 
   * @param sessionId - Session ID for routing audio
   * @param message - Audio chunk or end message
   * @param targetDeviceId - Optional specific device ID to send to (null = all kiosks)
   */
  broadcastAudioToKiosks(
    sessionId: string,
    message: AudioChunkMessage | AudioEndMessage,
    targetDeviceId?: string | null
  ): void {
    const devices = this.getDevicesBySession(sessionId);
    const kioskDevices = devices.filter(d => d.mode === 'kiosk');
    const payload = JSON.stringify(message);

    for (const device of kioskDevices) {
      // If targetDeviceId is specified, only send to that device
      if (targetDeviceId && device.id !== targetDeviceId) continue;

      if (device.ws.readyState === device.ws.OPEN) {
        device.ws.send(payload);
      }
    }
  }
}
