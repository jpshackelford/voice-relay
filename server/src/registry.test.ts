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
        workspaceId: 'workspace-1',
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

    // Issue #388: per-device mic listening state propagation.
    describe('listening state projection (issue #388)', () => {
      it('omits listening/sttSupported when never set', () => {
        registry.broadcastDeviceList('workspace-1');
        const sent = JSON.parse((ws1.send as ReturnType<typeof vi.fn>).mock.calls[0][0]);
        for (const d of sent.devices) {
          expect(d).not.toHaveProperty('listening');
          expect(d).not.toHaveProperty('sttSupported');
        }
      });

      it('projects listening/sttSupported on the device-list payload after setListeningState', () => {
        registry.setListeningState('device-1', true, true);
        registry.broadcastDeviceList('workspace-1');
        const sent = JSON.parse((ws1.send as ReturnType<typeof vi.fn>).mock.calls[0][0]);
        const dev1 = sent.devices.find((d: { id: string }) => d.id === 'device-1');
        const dev2 = sent.devices.find((d: { id: string }) => d.id === 'device-2');
        expect(dev1).toMatchObject({ listening: true, sttSupported: true });
        // device-2 never reported state — omitted (treated as not mic-capable)
        expect(dev2).not.toHaveProperty('listening');
        expect(dev2).not.toHaveProperty('sttSupported');
      });

      it('projects the latest values when state flips', () => {
        registry.setListeningState('device-1', true, true);
        registry.setListeningState('device-1', false, true);
        registry.broadcastDeviceList('workspace-1');
        const sent = JSON.parse((ws1.send as ReturnType<typeof vi.fn>).mock.calls[0][0]);
        const dev1 = sent.devices.find((d: { id: string }) => d.id === 'device-1');
        expect(dev1).toMatchObject({ listening: false, sttSupported: true });
      });

      it('setListeningState returns null for unknown ids (no-op)', () => {
        expect(registry.setListeningState('missing', true, true)).toBeNull();
      });

      it('drops projected listening row when device disconnects', () => {
        registry.setListeningState('device-1', true, true);
        // device-1 reported listening; verify it's there first.
        registry.broadcastDeviceList('workspace-1');
        const before = JSON.parse((ws2.send as ReturnType<typeof vi.fn>).mock.calls[0][0]);
        expect(before.devices.find((d: { id: string }) => d.id === 'device-1')).toBeDefined();

        // Disconnect via socket — the same path the WS close handler takes.
        const disconnectedId = registry.disconnectBySocket(ws1);
        expect(disconnectedId).toBe('device-1');

        // The next broadcast must not include device-1 at all (which means
        // the kiosk aggregate stops counting it toward "any listening"
        // within one round-trip, per the acceptance criteria).
        registry.broadcastDeviceList('workspace-1');
        const after = JSON.parse((ws2.send as ReturnType<typeof vi.fn>).mock.calls[1][0]);
        expect(after.devices.find((d: { id: string }) => d.id === 'device-1')).toBeUndefined();
      });

      it('isolates listening state per workspace', () => {
        registry.setListeningState('device-1', true, true);   // workspace-1
        registry.setListeningState('device-3', false, true);  // workspace-2

        registry.broadcastDeviceList('workspace-1');
        registry.broadcastDeviceList('workspace-2');

        const ws1Payload = JSON.parse((ws1.send as ReturnType<typeof vi.fn>).mock.calls[0][0]);
        const ws3Payload = JSON.parse((ws3.send as ReturnType<typeof vi.fn>).mock.calls[0][0]);

        expect(ws1Payload.devices.find((d: { id: string }) => d.id === 'device-1')).toMatchObject({
          listening: true,
          sttSupported: true,
        });
        expect(ws3Payload.devices.find((d: { id: string }) => d.id === 'device-3')).toMatchObject({
          listening: false,
          sttSupported: true,
        });
        // Cross-workspace: device-1 must not leak into workspace-2's payload.
        expect(ws3Payload.devices.find((d: { id: string }) => d.id === 'device-1')).toBeUndefined();
      });
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

    it('should broadcast to all kiosks across all workspaces with broadcastToAllKiosks', () => {
      const displayContent = {
        type: 'clear' as const,
      };

      registry.broadcastToAllKiosks(displayContent);

      // Both kiosks should receive (intentional global broadcast)
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

    // Issue #383: primaryUserId is cached on the in-memory device so the
    // per-utterance speaker resolver doesn't re-query `devices`.
    it('caches primaryUserId from register and refreshes via updateDevice', () => {
      const ws = createMockWebSocket();
      const device = registry.register(
        'device-1',
        'workspace-1',
        ws,
        'Test',
        'mobile',
        undefined, // screenWidth
        undefined, // screenHeight
        undefined, // sessionId
        undefined, // platform
        undefined, // tickersEnabled
        undefined, // timezone
        undefined, // tzOffsetMinutes
        'user-42'
      );
      expect(device.primaryUserId).toBe('user-42');

      const updated = registry.updateDevice('device-1', { primaryUserId: 'user-99' });
      expect(updated?.primaryUserId).toBe('user-99');
      expect(registry.getDevice('device-1')?.primaryUserId).toBe('user-99');

      const cleared = registry.updateDevice('device-1', { primaryUserId: null });
      expect(cleared?.primaryUserId).toBeNull();
    });

    it('refreshes cached primaryUserId on reconnection', () => {
      const ws1 = createMockWebSocket();
      registry.register(
        'device-1', 'workspace-1', ws1, 'Test', 'mobile',
        undefined, undefined, undefined, undefined, undefined, undefined, undefined,
        null,
      );
      expect(registry.getDevice('device-1')?.primaryUserId).toBeNull();

      const ws2 = createMockWebSocket();
      const reconnected = registry.register(
        'device-1', 'workspace-1', ws2, 'Test', 'mobile',
        undefined, undefined, undefined, undefined, undefined, undefined, undefined,
        'user-7',
      );
      expect(reconnected.primaryUserId).toBe('user-7');
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

  describe('session support', () => {
    it('should register a device with sessionId', () => {
      const ws = createMockWebSocket();
      const device = registry.register(
        'device-1',
        'workspace-1',
        ws,
        'Test Device',
        'mobile',
        undefined,
        undefined,
        'session-123'
      );

      expect(device.sessionId).toBe('session-123');
    });

    it('should update sessionId on reconnection', () => {
      const ws1 = createMockWebSocket();
      const ws2 = createMockWebSocket();
      
      registry.register('device-1', 'workspace-1', ws1, 'Device 1', 'mobile', undefined, undefined, 'session-a');
      const device = registry.register('device-1', 'workspace-1', ws2, 'Device 1', 'mobile', undefined, undefined, 'session-b');

      expect(device.sessionId).toBe('session-b');
    });

    it('should get devices by session', () => {
      const ws1 = createMockWebSocket();
      const ws2 = createMockWebSocket();
      const ws3 = createMockWebSocket();
      
      registry.register('device-1', 'workspace-1', ws1, 'Device 1', 'mobile', undefined, undefined, 'session-a');
      registry.register('device-2', 'workspace-1', ws2, 'Device 2', 'mobile', undefined, undefined, 'session-a');
      registry.register('device-3', 'workspace-1', ws3, 'Device 3', 'mobile', undefined, undefined, 'session-b');

      const sessionADevices = registry.getDevicesBySession('session-a');
      expect(sessionADevices).toHaveLength(2);
      expect(sessionADevices.map(d => d.id)).toContain('device-1');
      expect(sessionADevices.map(d => d.id)).toContain('device-2');

      const sessionBDevices = registry.getDevicesBySession('session-b');
      expect(sessionBDevices).toHaveLength(1);
      expect(sessionBDevices[0].id).toBe('device-3');
    });

    it('should broadcast to session only', () => {
      const ws1 = createMockWebSocket();
      const ws2 = createMockWebSocket();
      const ws3 = createMockWebSocket();
      
      registry.register('device-1', 'workspace-1', ws1, 'Device 1', 'mobile', undefined, undefined, 'session-a');
      registry.register('device-2', 'workspace-1', ws2, 'Device 2', 'mobile', undefined, undefined, 'session-a');
      registry.register('device-3', 'workspace-1', ws3, 'Device 3', 'mobile', undefined, undefined, 'session-b');

      const message = {
        type: 'text' as const,
        utteranceId: 'test-123',
        senderId: 'device-1',
        senderName: 'Test',
        text: 'Hello',
        partial: false,
        workspaceId: 'workspace-1',
        sessionId: 'session-a',
      };

      registry.broadcastToSession(message, 'session-a', 'device-1');

      // ws1 is excluded (sender)
      expect(ws1.send).not.toHaveBeenCalled();
      // ws2 is in session-a, should receive
      expect(ws2.send).toHaveBeenCalledTimes(1);
      // ws3 is in session-b, should not receive
      expect(ws3.send).not.toHaveBeenCalled();
    });

    it('should isolate messages between sessions in the same workspace', () => {
      const ws1 = createMockWebSocket();
      const ws2 = createMockWebSocket();
      
      // Both devices in same workspace, different sessions
      registry.register('device-1', 'workspace-1', ws1, 'Device 1', 'mobile', undefined, undefined, 'session-a');
      registry.register('device-2', 'workspace-1', ws2, 'Device 2', 'mobile', undefined, undefined, 'session-b');

      const message = {
        type: 'text' as const,
        utteranceId: 'test-123',
        senderId: 'external',
        senderName: 'External',
        text: 'Hello Session A',
        partial: false,
        workspaceId: 'workspace-1',
        sessionId: 'session-a',
      };

      registry.broadcastToSession(message, 'session-a');

      // Only device-1 in session-a should receive
      expect(ws1.send).toHaveBeenCalledTimes(1);
      // device-2 in session-b should not receive
      expect(ws2.send).not.toHaveBeenCalled();
    });

    it('should return empty array for session with no devices', () => {
      const ws = createMockWebSocket();
      registry.register('device-1', 'workspace-1', ws, 'Test', 'mobile', undefined, undefined, 'session-a');

      const emptySession = registry.getDevicesBySession('session-999');
      expect(emptySession).toHaveLength(0);
    });

    it('should broadcast any message type to session using broadcastMessageToSession', () => {
      const ws1 = createMockWebSocket();
      const ws2 = createMockWebSocket();
      const ws3 = createMockWebSocket();
      
      registry.register('device-1', 'workspace-1', ws1, 'Device 1', 'mobile', undefined, undefined, 'session-a');
      registry.register('device-2', 'workspace-1', ws2, 'Device 2', 'mobile', undefined, undefined, 'session-a');
      registry.register('device-3', 'workspace-1', ws3, 'Device 3', 'mobile', undefined, undefined, 'session-b');

      const statusMessage = {
        type: 'session-ai-status',
        sessionId: 'session-a',
        connecting: true,
        connected: false,
      };

      registry.broadcastMessageToSession('session-a', statusMessage);

      // Both devices in session-a should receive the message
      expect(ws1.send).toHaveBeenCalledTimes(1);
      expect(ws2.send).toHaveBeenCalledTimes(1);
      expect(ws1.send).toHaveBeenCalledWith(JSON.stringify(statusMessage));
      // Device in session-b should not receive
      expect(ws3.send).not.toHaveBeenCalled();
    });

    it('should exclude specified device in broadcastMessageToSession', () => {
      const ws1 = createMockWebSocket();
      const ws2 = createMockWebSocket();
      
      registry.register('device-1', 'workspace-1', ws1, 'Device 1', 'mobile', undefined, undefined, 'session-a');
      registry.register('device-2', 'workspace-1', ws2, 'Device 2', 'mobile', undefined, undefined, 'session-a');

      const statusMessage = {
        type: 'session-ai-status',
        sessionId: 'session-a',
        connected: true,
      };

      registry.broadcastMessageToSession('session-a', statusMessage, 'device-1');

      // device-1 should be excluded
      expect(ws1.send).not.toHaveBeenCalled();
      // device-2 should receive
      expect(ws2.send).toHaveBeenCalledTimes(1);
    });
  });

  describe('disconnectWorkspaceDevices', () => {
    it('should disconnect all devices in a workspace', () => {
      const ws1 = createMockWebSocket();
      const ws2 = createMockWebSocket();
      
      registry.register('device-1', 'workspace-1', ws1, 'Device 1', 'mobile');
      registry.register('device-2', 'workspace-1', ws2, 'Device 2', 'kiosk');

      const count = registry.disconnectWorkspaceDevices('workspace-1');

      expect(count).toBe(2);
      expect(ws1.send).toHaveBeenCalledWith(JSON.stringify({ type: 'workspace-deleted', reason: undefined }));
      expect(ws1.close).toHaveBeenCalledWith(1000, 'Workspace deleted');
      expect(ws2.send).toHaveBeenCalledWith(JSON.stringify({ type: 'workspace-deleted', reason: undefined }));
      expect(ws2.close).toHaveBeenCalledWith(1000, 'Workspace deleted');
      expect(registry.getDevice('device-1')).toBeUndefined();
      expect(registry.getDevice('device-2')).toBeUndefined();
    });

    it('should include reason in the disconnect message', () => {
      const ws = createMockWebSocket();
      registry.register('device-1', 'workspace-1', ws, 'Device 1', 'mobile');

      registry.disconnectWorkspaceDevices('workspace-1', 'Owner deleted the workspace');

      expect(ws.send).toHaveBeenCalledWith(JSON.stringify({
        type: 'workspace-deleted',
        reason: 'Owner deleted the workspace',
      }));
    });

    it('should handle devices with closed WebSockets', () => {
      const wsOpen = createMockWebSocket(1); // OPEN
      const wsClosed = createMockWebSocket(3); // CLOSED
      
      registry.register('device-1', 'workspace-1', wsOpen, 'Open Device', 'mobile');
      registry.register('device-2', 'workspace-1', wsClosed, 'Closed Device', 'mobile');

      const count = registry.disconnectWorkspaceDevices('workspace-1');

      // Both devices should be removed from registry
      expect(count).toBe(2);
      expect(registry.getDevice('device-1')).toBeUndefined();
      expect(registry.getDevice('device-2')).toBeUndefined();
      
      // Only the open socket should have received messages
      expect(wsOpen.send).toHaveBeenCalled();
      expect(wsOpen.close).toHaveBeenCalled();
      expect(wsClosed.send).not.toHaveBeenCalled();
      expect(wsClosed.close).not.toHaveBeenCalled();
    });

    it('should continue on per-device errors and still remove from registry', () => {
      const ws1 = createMockWebSocket();
      const ws2 = createMockWebSocket();
      
      // Make the first device's send throw
      (ws1.send as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('Network error');
      });
      
      registry.register('device-1', 'workspace-1', ws1, 'Broken Device', 'mobile');
      registry.register('device-2', 'workspace-1', ws2, 'Good Device', 'mobile');

      // Should not throw, and should still process the second device
      const count = registry.disconnectWorkspaceDevices('workspace-1');

      // Only the successful device is counted, but both are removed from registry
      // (failed devices will timeout/disconnect naturally)
      expect(count).toBe(1);
      expect(registry.getDevice('device-1')).toBeUndefined(); // removed even on error
      expect(registry.getDevice('device-2')).toBeUndefined();
      
      // Second device should have received the message
      expect(ws2.send).toHaveBeenCalled();
      expect(ws2.close).toHaveBeenCalled();
    });

    it('should return 0 for workspace with no devices', () => {
      const count = registry.disconnectWorkspaceDevices('empty-workspace');
      expect(count).toBe(0);
    });

    it('should not affect devices in other workspaces', () => {
      const ws1 = createMockWebSocket();
      const ws2 = createMockWebSocket();
      
      registry.register('device-1', 'workspace-1', ws1, 'WS1 Device', 'mobile');
      registry.register('device-2', 'workspace-2', ws2, 'WS2 Device', 'mobile');

      registry.disconnectWorkspaceDevices('workspace-1');

      // workspace-1 device should be gone
      expect(registry.getDevice('device-1')).toBeUndefined();
      expect(ws1.close).toHaveBeenCalled();
      
      // workspace-2 device should still exist
      expect(registry.getDevice('device-2')).toBeDefined();
      expect(ws2.send).not.toHaveBeenCalled();
      expect(ws2.close).not.toHaveBeenCalled();
    });
  });

  // Issue #393: kiosk picker enrichment on broadcastDeviceList.
  describe('kiosk picker enrichment (#393)', () => {
    it('enriches kiosk entries with activeSessionId and lastUsedAt', () => {
      const wsMobile = createMockWebSocket();
      const wsKiosk = createMockWebSocket();
      registry.register('mobile-1', 'ws-1', wsMobile, 'Mobile', 'mobile');
      registry.register('kiosk-1', 'ws-1', wsKiosk, 'Conference Room A', 'kiosk');

      registry.setKioskEnricher(() => new Map([
        ['kiosk-1', { activeSessionId: 'sess-1', lastUsedAt: '2026-06-04T10:00:00Z' }],
      ]));

      registry.broadcastDeviceList('ws-1');

      const mobileMsg = JSON.parse((wsMobile.send as ReturnType<typeof vi.fn>).mock.calls[0][0]);
      expect(mobileMsg.type).toBe('device-list');
      const kioskEntry = mobileMsg.devices.find(
        (d: { id: string }) => d.id === 'kiosk-1',
      );
      expect(kioskEntry.activeSessionId).toBe('sess-1');
      expect(kioskEntry.lastUsedAt).toBe('2026-06-04T10:00:00Z');

      const mobileEntry = mobileMsg.devices.find(
        (d: { id: string }) => d.id === 'mobile-1',
      );
      // Mobile entries are NOT enriched.
      expect(mobileEntry.activeSessionId).toBeUndefined();
      expect(mobileEntry.lastUsedAt).toBeUndefined();
    });

    it('falls back to null when the enricher has no entry for a kiosk', () => {
      const ws = createMockWebSocket();
      registry.register('kiosk-orphan', 'ws-1', ws, 'Orphan', 'kiosk');
      registry.setKioskEnricher(() => new Map());

      registry.broadcastDeviceList('ws-1');
      const msg = JSON.parse((ws.send as ReturnType<typeof vi.fn>).mock.calls[0][0]);
      const entry = msg.devices[0];
      expect(entry.id).toBe('kiosk-orphan');
      expect(entry.activeSessionId).toBeNull();
      expect(entry.lastUsedAt).toBeNull();
    });

    it('omits enrichment entirely when no enricher is installed', () => {
      const ws = createMockWebSocket();
      registry.register('kiosk-bare', 'ws-1', ws, 'Bare', 'kiosk');

      registry.broadcastDeviceList('ws-1');
      const msg = JSON.parse((ws.send as ReturnType<typeof vi.fn>).mock.calls[0][0]);
      const entry = msg.devices[0];
      expect('activeSessionId' in entry).toBe(false);
      expect('lastUsedAt' in entry).toBe(false);
    });

    it('clears the enricher when set to null', () => {
      const ws = createMockWebSocket();
      registry.register('kiosk-1', 'ws-1', ws, 'K', 'kiosk');

      registry.setKioskEnricher(() => new Map([
        ['kiosk-1', { activeSessionId: 'sess-x', lastUsedAt: null }],
      ]));
      registry.setKioskEnricher(null);

      registry.broadcastDeviceList('ws-1');
      const msg = JSON.parse((ws.send as ReturnType<typeof vi.fn>).mock.calls[0][0]);
      expect('activeSessionId' in msg.devices[0]).toBe(false);
    });
  });
});
