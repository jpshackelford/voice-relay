import type { WebSocket } from 'ws';
import type { Device, DeviceInfo, DeviceMode, RelayedTextMessage, DeviceListMessage, DisplayMessage, DisplayContent } from './types.js';

// Display calculation constants (from CSS)
const DISPLAY_PADDING_PX = 96;      // 3rem * 2 = 48px * 2
const DISPLAY_TITLE_HEIGHT_PX = 72; // title font-size + margin
const LINE_HEIGHT_PX = 45;          // 1.75rem * 1.6 line-height ≈ 45px
const SIDEBAR_RATIO = 0.382;        // Golden ratio sidebar

/**
 * Calculate maximum displayable lines for a kiosk screen
 */
function calculateDisplayLines(screenWidth: number, screenHeight: number): number {
  // Kiosk display takes remaining space after sidebar
  // Available height = screenHeight - padding - title
  const availableHeight = screenHeight - DISPLAY_PADDING_PX - DISPLAY_TITLE_HEIGHT_PX;
  const lines = Math.floor(availableHeight / LINE_HEIGHT_PX);
  // Minimum 5 lines, maximum 30 lines (sanity bounds)
  return Math.max(5, Math.min(30, lines));
}

export class DeviceRegistry {
  private devices = new Map<string, Device>();

  register(
    id: string, 
    workspaceId: string,
    ws: WebSocket, 
    displayName: string, 
    mode: DeviceMode,
    screenWidth?: number,
    screenHeight?: number,
    sessionId?: string
  ): Device {
    const existing = this.devices.get(id);
    if (existing) {
      // Reconnection: update WebSocket reference, workspace, session, and screen info
      existing.ws = ws;
      existing.workspaceId = workspaceId;
      existing.sessionId = sessionId;
      existing.displayName = displayName;
      existing.mode = mode;
      // Only track screen dimensions for kiosk devices (they have the display)
      if (mode === 'kiosk') {
        if (screenWidth) existing.screenWidth = screenWidth;
        if (screenHeight) existing.screenHeight = screenHeight;
        if (screenWidth && screenHeight) {
          existing.displayLines = calculateDisplayLines(screenWidth, screenHeight);
        }
        console.log(`[Registry] Kiosk reconnected: ${displayName} (${id}) in workspace ${workspaceId}, session ${sessionId || 'none'}, ${existing.displayLines || '?'} display lines`);
      } else {
        console.log(`[Registry] Device reconnected: ${displayName} (${id}) as ${mode} in workspace ${workspaceId}, session ${sessionId || 'none'}`);
      }
      return existing;
    }

    // Only calculate displayLines for kiosk devices - mobile/other devices are voice-only
    const displayLines = (mode === 'kiosk' && screenWidth && screenHeight) 
      ? calculateDisplayLines(screenWidth, screenHeight) 
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
    };
    this.devices.set(id, device);
    
    if (mode === 'kiosk') {
      console.log(`[Registry] Kiosk registered: ${displayName} (${id}) in workspace ${workspaceId}, session ${sessionId || 'none'}, ${displayLines || '?'} display lines`);
    } else {
      console.log(`[Registry] Device registered: ${displayName} (${id}) as ${mode} in workspace ${workspaceId}, session ${sessionId || 'none'}`);
    }
    return device;
  }

  updateDevice(id: string, updates: Partial<Pick<Device, 'displayName' | 'mode' | 'ttsEnabled'>>): Device | null {
    const device = this.devices.get(id);
    if (!device) return null;

    if (updates.displayName !== undefined) device.displayName = updates.displayName;
    if (updates.mode !== undefined) device.mode = updates.mode;
    if (updates.ttsEnabled !== undefined) device.ttsEnabled = updates.ttsEnabled;

    console.log(`[Registry] Device updated: ${device.displayName} (${id})`);
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
   * Broadcast the device list to all devices in a workspace.
   * Each device only sees devices in their own workspace.
   */
  broadcastDeviceList(workspaceId: string): void {
    const devicesInWorkspace = this.getDevicesByWorkspace(workspaceId);
    const deviceList = devicesInWorkspace.map(d => ({
      id: d.id,
      workspaceId: d.workspaceId,
      displayName: d.displayName,
      mode: d.mode,
    }));
    
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
}
