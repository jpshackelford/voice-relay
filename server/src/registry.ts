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
    ws: WebSocket, 
    displayName: string, 
    mode: DeviceMode,
    screenWidth?: number,
    screenHeight?: number
  ): Device {
    const existing = this.devices.get(id);
    if (existing) {
      // Reconnection: update WebSocket reference and screen info
      existing.ws = ws;
      existing.displayName = displayName;
      existing.mode = mode;
      // Only track screen dimensions for kiosk devices (they have the display)
      if (mode === 'kiosk') {
        if (screenWidth) existing.screenWidth = screenWidth;
        if (screenHeight) existing.screenHeight = screenHeight;
        if (screenWidth && screenHeight) {
          existing.displayLines = calculateDisplayLines(screenWidth, screenHeight);
        }
        console.log(`[Registry] Kiosk reconnected: ${displayName} (${id}), ${existing.displayLines || '?'} display lines`);
      } else {
        console.log(`[Registry] Device reconnected: ${displayName} (${id}) as ${mode}`);
      }
      return existing;
    }

    // Only calculate displayLines for kiosk devices - mobile/other devices are voice-only
    const displayLines = (mode === 'kiosk' && screenWidth && screenHeight) 
      ? calculateDisplayLines(screenWidth, screenHeight) 
      : undefined;

    const device: Device = {
      id,
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
      console.log(`[Registry] Kiosk registered: ${displayName} (${id}), ${displayLines || '?'} display lines`);
    } else {
      console.log(`[Registry] Device registered: ${displayName} (${id}) as ${mode}`);
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

  getMobileDevices(): Device[] {
    return [...this.devices.values()].filter(d => d.mode === 'mobile');
  }

  getKioskDevices(): Device[] {
    return [...this.devices.values()].filter(d => d.mode === 'kiosk');
  }

  getReceivingDevices(): Device[] {
    // All devices can receive messages (both mobile and kiosk)
    return [...this.devices.values()];
  }

  /**
   * Get the minimum display lines across all connected kiosk devices.
   * Returns undefined if no kiosk devices have screen info.
   * This is the safe maximum to use for content that must fit all screens.
   */
  getMinKioskDisplayLines(): number | undefined {
    const kioskDevices = this.getKioskDevices();
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

  getDeviceList(): DeviceInfo[] {
    return this.getAllDevices().map(d => ({
      id: d.id,
      displayName: d.displayName,
      mode: d.mode,
    }));
  }

  broadcastToOutputs(message: RelayedTextMessage, excludeId?: string): void {
    const receivers = this.getReceivingDevices();
    const payload = JSON.stringify(message);

    for (const device of receivers) {
      if (device.id !== excludeId && device.ws.readyState === device.ws.OPEN) {
        device.ws.send(payload);
      }
    }
  }

  broadcastDeviceList(): void {
    const message: DeviceListMessage = {
      type: 'device-list',
      devices: this.getDeviceList(),
    };
    const payload = JSON.stringify(message);

    for (const device of this.getAllDevices()) {
      if (device.ws.readyState === device.ws.OPEN) {
        device.ws.send(payload);
      }
    }
  }

  broadcastToKiosks(displayContent: DisplayContent): void {
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
}
