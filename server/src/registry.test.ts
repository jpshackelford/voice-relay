import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DeviceRegistry } from './registry.js';
import type { WebSocket } from 'ws';
import type { DeviceMode } from './types.js';

function createMockWebSocket(readyState = 1): WebSocket {
  return {
    readyState,
    OPEN: 1,
    send: vi.fn(),
    close: vi.fn(),
  } as unknown as WebSocket;
}

describe('DeviceRegistry', () => {
  let registry: DeviceRegistry;
  
  beforeEach(() => {
    registry = new DeviceRegistry();
  });

  describe('register', () => {
    it('should register a device with workspace', () => {
      const ws = createMockWebSocket();
      const device = registry.register(
        'device-1',
        'workspace-1',
        ws,
        'Test Device',
        'mobile'
      );

      expect(device.id).toBe('device-1');
      expect(device.workspaceId).toBe('workspace-1');
      expect(device.displayName).toBe('Test Device');
      expect(device.mode).toBe('mobile');
      expect(device.ws).toBe(ws);
    });

    it('should register a kiosk with screen dimensions', () => {
      const ws = createMockWebSocket();
      const device = registry.register(
        'kiosk-1',
        'workspace-1',
        ws,
        'Test Kiosk',
        'kiosk',
        1920,
        1080
      );

      expect(device.id).toBe('kiosk-1');
      expect(device.mode).toBe('kiosk');
      expect(device.screenWidth).toBe(1920);
      expect(device.screenHeight).toBe(1080);
      expect(device.displayLines).toBeDefined();
      expect(device.displayLines).toBeGreaterThan(0);
    });

    it('should update existing device on reconnection', () => {
      const ws1 = createMockWebSocket();
      const ws2 = createMockWebSocket();
      
      registry.register('device-1', 'workspace-1', ws1, 'Device 1', 'mobile');
      const device = registry.register('device-1', 'workspace-2', ws2, 'Device 1 Updated', 'kiosk');

      expect(device.ws).toBe(ws2);
      expect(device.workspaceId).toBe('workspace-2');
      expect(device.displayName).toBe('Device 1 Updated');
      expect(device.mode).toBe('kiosk');
    });

    it('should update kiosk screen dimensions on reconnection', () => {
      const ws1 = createMockWebSocket();
      const ws2 = createMockWebSocket();
      
      // First register as kiosk with screen dimensions
      registry.register('kiosk-1', 'workspace-1', ws1, 'Kiosk', 'kiosk', 1920, 1080);
      
      // Reconnect with new screen dimensions
      const device = registry.register('kiosk-1', 'workspace-1', ws2, 'Kiosk Updated', 'kiosk', 2560, 1440);

      expect(device.ws).toBe(ws2);
      expect(device.displayName).toBe('Kiosk Updated');
      expect(device.screenWidth).toBe(2560);
      expect(device.screenHeight).toBe(1440);
      expect(device.displayLines).toBeDefined();
    });

    it('should update mobile to kiosk on reconnection with partial dimensions', () => {
      const ws1 = createMockWebSocket();
      const ws2 = createMockWebSocket();
      
      // First register as mobile
      registry.register('device-1', 'workspace-1', ws1, 'Mobile', 'mobile');
      
      // Reconnect as kiosk with only screenWidth (should not calculate displayLines)
      const device = registry.register('device-1', 'workspace-1', ws2, 'Kiosk', 'kiosk', 1920);

      expect(device.mode).toBe('kiosk');
      expect(device.screenWidth).toBe(1920);
      expect(device.displayLines).toBeUndefined();
    });
  });

  describe('canSend and canReceive', () => {
    it('should allow mobile devices to send', () => {
      const ws = createMockWebSocket();
      const device = registry.register('device-1', 'workspace-1', ws, 'Mobile', 'mobile');
      
      expect(registry.canSend(device)).toBe(true);
    });

    it('should allow kiosk devices to send', () => {
      const ws = createMockWebSocket();
      const device = registry.register('device-1', 'workspace-1', ws, 'Kiosk', 'kiosk');
      
      expect(registry.canSend(device)).toBe(true);
    });

    it('should allow mobile devices to receive', () => {
      const ws = createMockWebSocket();
      const device = registry.register('device-1', 'workspace-1', ws, 'Mobile', 'mobile');
      
      expect(registry.canReceive(device)).toBe(true);
    });

    it('should allow kiosk devices to receive', () => {
      const ws = createMockWebSocket();
      const device = registry.register('device-1', 'workspace-1', ws, 'Kiosk', 'kiosk');
      
      expect(registry.canReceive(device)).toBe(true);
    });
  });

  describe('workspace scoping', () => {
    beforeEach(() => {
      const ws1 = createMockWebSocket();
      const ws2 = createMockWebSocket();
      const ws3 = createMockWebSocket();
      const ws4 = createMockWebSocket();

      registry.register('device-1', 'workspace-1', ws1, 'WS1 Mobile', 'mobile');
      registry.register('device-2', 'workspace-1', ws2, 'WS1 Kiosk', 'kiosk', 1920, 1080);
      registry.register('device-3', 'workspace-2', ws3, 'WS2 Mobile', 'mobile');
      registry.register('device-4', 'workspace-2', ws4, 'WS2 Kiosk', 'kiosk', 1920, 1080);
    });

    it('should get devices by workspace', () => {
      const ws1Devices = registry.getDevicesByWorkspace('workspace-1');
      const ws2Devices = registry.getDevicesByWorkspace('workspace-2');

      expect(ws1Devices).toHaveLength(2);
      expect(ws2Devices).toHaveLength(2);
      expect(ws1Devices.map(d => d.id)).toContain('device-1');
      expect(ws1Devices.map(d => d.id)).toContain('device-2');
      expect(ws2Devices.map(d => d.id)).toContain('device-3');
      expect(ws2Devices.map(d => d.id)).toContain('device-4');
    });

    it('should get mobile devices by workspace', () => {
      const ws1Mobile = registry.getMobileDevices('workspace-1');
      const ws2Mobile = registry.getMobileDevices('workspace-2');
      const allMobile = registry.getMobileDevices();

      expect(ws1Mobile).toHaveLength(1);
      expect(ws1Mobile[0].id).toBe('device-1');
      expect(ws2Mobile).toHaveLength(1);
      expect(ws2Mobile[0].id).toBe('device-3');
      expect(allMobile).toHaveLength(2);
    });

    it('should get kiosk devices by workspace', () => {
      const ws1Kiosks = registry.getKioskDevices('workspace-1');
      const ws2Kiosks = registry.getKioskDevices('workspace-2');
      const allKiosks = registry.getKioskDevices();

      expect(ws1Kiosks).toHaveLength(1);
      expect(ws1Kiosks[0].id).toBe('device-2');
      expect(ws2Kiosks).toHaveLength(1);
      expect(ws2Kiosks[0].id).toBe('device-4');
      expect(allKiosks).toHaveLength(2);
    });

    it('should get receiving devices by workspace', () => {
      const ws1Receivers = registry.getReceivingDevices('workspace-1');
      const ws2Receivers = registry.getReceivingDevices('workspace-2');
      const allReceivers = registry.getReceivingDevices();

      expect(ws1Receivers).toHaveLength(2);
      expect(ws2Receivers).toHaveLength(2);
      expect(allReceivers).toHaveLength(4);
    });

    it('should get device list by workspace', () => {
      const ws1List = registry.getDeviceList('workspace-1');
      const ws2List = registry.getDeviceList('workspace-2');
      const allDevices = registry.getDeviceList();

      expect(ws1List).toHaveLength(2);
      expect(ws2List).toHaveLength(2);
      expect(allDevices).toHaveLength(4);
      
      // Check that device info includes workspaceId
      expect(ws1List[0].workspaceId).toBe('workspace-1');
      expect(ws2List[0].workspaceId).toBe('workspace-2');
    });

    it('should get min kiosk display lines by workspace', () => {
      const ws1Lines = registry.getMinKioskDisplayLines('workspace-1');
      const ws2Lines = registry.getMinKioskDisplayLines('workspace-2');
      const allLines = registry.getMinKioskDisplayLines();

      expect(ws1Lines).toBeDefined();
      expect(ws2Lines).toBeDefined();
      expect(allLines).toBeDefined();
    });
  });

  describe('broadcast operations', () => {
    let ws1: WebSocket, ws2: WebSocket, ws3: WebSocket, ws4: WebSocket;

    beforeEach(() => {
      ws1 = createMockWebSocket();
      ws2 = createMockWebSocket();
      ws3 = createMockWebSocket();
      ws4 = createMockWebSocket();

      registry.register('device-1', 'workspace-1', ws1, 'WS1 Mobile', 'mobile');
      registry.register('device-2', 'workspace-1', ws2, 'WS1 Kiosk', 'kiosk', 1920, 1080);
      registry.register('device-3', 'workspace-2', ws3, 'WS2 Mobile', 'mobile');
      registry.register('device-4', 'workspace-2', ws4, 'WS2 Kiosk', 'kiosk', 1920, 1080);
    });

    it('should broadcast to outputs only within workspace', () => {
      const message = {
        type: 'text' as const,
        utteranceId: 'test-123',
        senderId: 'device-1',
        senderName: 'Test',
        text: 'Hello',
        partial: false,
      };

      registry.broadcastToOutputs(message, 'workspace-1', 'device-1');

      // ws1 is excluded (sender)
      expect(ws1.send).not.toHaveBeenCalled();
      // ws2 is in workspace-1, should receive
      expect(ws2.send).toHaveBeenCalledTimes(1);
      // ws3 and ws4 are in workspace-2, should not receive
      expect(ws3.send).not.toHaveBeenCalled();
      expect(ws4.send).not.toHaveBeenCalled();
    });

    it('should broadcast device list only within workspace', () => {
      registry.broadcastDeviceList('workspace-1');

      expect(ws1.send).toHaveBeenCalledTimes(1);
      expect(ws2.send).toHaveBeenCalledTimes(1);
      expect(ws3.send).not.toHaveBeenCalled();
      expect(ws4.send).not.toHaveBeenCalled();

      // Verify the message contains only workspace-1 devices
      const sentMessage = JSON.parse((ws1.send as ReturnType<typeof vi.fn>).mock.calls[0][0]);
      expect(sentMessage.type).toBe('device-list');
      expect(sentMessage.devices).toHaveLength(2);
      expect(sentMessage.devices.every((d: { workspaceId: string }) => d.workspaceId === 'workspace-1')).toBe(true);
    });

    it('should broadcast to kiosks only within workspace', () => {
      const displayContent = {
        type: 'markdown' as const,
        content: 'Hello World',
        title: 'Test',
      };

      registry.broadcastToKiosks(displayContent, 'workspace-1');

      // Only kiosks in workspace-1 should receive
      expect(ws1.send).not.toHaveBeenCalled(); // mobile
      expect(ws2.send).toHaveBeenCalledTimes(1); // kiosk in ws-1
      expect(ws3.send).not.toHaveBeenCalled(); // mobile in ws-2
      expect(ws4.send).not.toHaveBeenCalled(); // kiosk in ws-2
    });

    it('should broadcast to all kiosks when no workspace specified', () => {
      const displayContent = {
        type: 'clear' as const,
      };

      registry.broadcastToKiosks(displayContent);

      // Both kiosks should receive
      expect(ws1.send).not.toHaveBeenCalled(); // mobile
      expect(ws2.send).toHaveBeenCalledTimes(1); // kiosk
      expect(ws3.send).not.toHaveBeenCalled(); // mobile
      expect(ws4.send).toHaveBeenCalledTimes(1); // kiosk
    });
  });

  describe('disconnect', () => {
    it('should disconnect a device', () => {
      const ws = createMockWebSocket();
      registry.register('device-1', 'workspace-1', ws, 'Test', 'mobile');
      
      expect(registry.getDevice('device-1')).toBeDefined();
      
      registry.disconnect('device-1');
      
      expect(registry.getDevice('device-1')).toBeUndefined();
    });

    it('should disconnect by socket', () => {
      const ws = createMockWebSocket();
      registry.register('device-1', 'workspace-1', ws, 'Test', 'mobile');
      
      const disconnectedId = registry.disconnectBySocket(ws);
      
      expect(disconnectedId).toBe('device-1');
      expect(registry.getDevice('device-1')).toBeUndefined();
    });
  });

  describe('updateDevice', () => {
    it('should update device properties', () => {
      const ws = createMockWebSocket();
      registry.register('device-1', 'workspace-1', ws, 'Test', 'mobile');
      
      const updated = registry.updateDevice('device-1', {
        displayName: 'Updated Name',
        mode: 'kiosk',
        ttsEnabled: true,
      });

      expect(updated).not.toBeNull();
      expect(updated?.displayName).toBe('Updated Name');
      expect(updated?.mode).toBe('kiosk');
      expect(updated?.ttsEnabled).toBe(true);
    });

    it('should return null for non-existent device', () => {
      const result = registry.updateDevice('non-existent', { displayName: 'Test' });
      expect(result).toBeNull();
    });
  });

  describe('sendToDevice', () => {
    it('should send message to a specific device', () => {
      const ws = createMockWebSocket();
      registry.register('device-1', 'workspace-1', ws, 'Test', 'mobile');
      
      const message = { type: 'test', data: 'hello' };
      const result = registry.sendToDevice('device-1', message);

      expect(result).toBe(true);
      expect(ws.send).toHaveBeenCalledWith(JSON.stringify(message));
    });

    it('should return false for non-existent device', () => {
      const result = registry.sendToDevice('non-existent', { type: 'test' });
      expect(result).toBe(false);
    });

    it('should return false for closed connection', () => {
      const ws = createMockWebSocket(3); // CLOSED state
      registry.register('device-1', 'workspace-1', ws, 'Test', 'mobile');
      
      const result = registry.sendToDevice('device-1', { type: 'test' });
      expect(result).toBe(false);
    });
  });

  describe('device isolation', () => {
    it('should not leak devices between workspaces', () => {
      const ws1 = createMockWebSocket();
      const ws2 = createMockWebSocket();
      
      registry.register('device-1', 'workspace-1', ws1, 'WS1 Device', 'mobile');
      registry.register('device-2', 'workspace-2', ws2, 'WS2 Device', 'mobile');

      // workspace-1 should only see its own devices
      const ws1Devices = registry.getDevicesByWorkspace('workspace-1');
      expect(ws1Devices).toHaveLength(1);
      expect(ws1Devices[0].id).toBe('device-1');
      expect(ws1Devices.some(d => d.id === 'device-2')).toBe(false);

      // workspace-2 should only see its own devices
      const ws2Devices = registry.getDevicesByWorkspace('workspace-2');
      expect(ws2Devices).toHaveLength(1);
      expect(ws2Devices[0].id).toBe('device-2');
      expect(ws2Devices.some(d => d.id === 'device-1')).toBe(false);
    });

    it('should return empty array for workspace with no devices', () => {
      const ws = createMockWebSocket();
      registry.register('device-1', 'workspace-1', ws, 'Test', 'mobile');

      const emptyWorkspace = registry.getDevicesByWorkspace('workspace-999');
      expect(emptyWorkspace).toHaveLength(0);
    });
  });
});
