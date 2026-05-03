import type { WebSocket } from 'ws';
import type { Device, DeviceInfo, DeviceMode, RelayedTextMessage, DeviceListMessage, DisplayMessage, DisplayContent } from './types.js';

export class DeviceRegistry {
  private devices = new Map<string, Device>();

  register(id: string, ws: WebSocket, displayName: string, mode: DeviceMode): Device {
    const existing = this.devices.get(id);
    if (existing) {
      // Reconnection: update WebSocket reference
      existing.ws = ws;
      existing.displayName = displayName;
      existing.mode = mode;
      console.log(`[Registry] Device reconnected: ${displayName} (${id}) as ${mode}`);
      return existing;
    }

    const device: Device = {
      id,
      displayName,
      mode,
      ws,
      connectedAt: new Date(),
    };
    this.devices.set(id, device);
    console.log(`[Registry] Device registered: ${displayName} (${id}) as ${mode}`);
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

  getOutputDevices(): Device[] {
    return [...this.devices.values()].filter(d => d.mode === 'output');
  }

  getInputDevices(): Device[] {
    return [...this.devices.values()].filter(d => d.mode === 'input');
  }

  getChatDevices(): Device[] {
    return [...this.devices.values()].filter(d => d.mode === 'chat');
  }

  getReceivingDevices(): Device[] {
    return [...this.devices.values()].filter(d => d.mode === 'output' || d.mode === 'chat' || d.mode === 'kiosk');
  }

  getKioskDevices(): Device[] {
    return [...this.devices.values()].filter(d => d.mode === 'kiosk');
  }

  canSend(device: Device): boolean {
    return device.mode === 'input' || device.mode === 'chat' || device.mode === 'kiosk';
  }

  canReceive(device: Device): boolean {
    return device.mode === 'output' || device.mode === 'chat' || device.mode === 'kiosk';
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
}
