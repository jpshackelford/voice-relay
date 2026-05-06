import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryStore } from './memory.js';
import type { RelayedTextMessage } from '../types.js';

describe('MemoryStore', () => {
  let store: MemoryStore;

  const createMessage = (overrides: Partial<RelayedTextMessage> = {}): RelayedTextMessage => ({
    type: 'text',
    utteranceId: `utt-${Date.now()}`,
    workspaceId: 'test-workspace',
    senderId: 'device-1',
    senderName: 'Test Device',
    text: 'Hello, world!',
    partial: false,
    ...overrides,
  });

  beforeEach(() => {
    store = new MemoryStore();
  });

  describe('connect/disconnect', () => {
    it('connect is a no-op', async () => {
      await expect(store.connect()).resolves.not.toThrow();
    });

    it('disconnect is a no-op', async () => {
      await expect(store.disconnect()).resolves.not.toThrow();
    });
  });

  describe('append', () => {
    it('stores a message', async () => {
      await store.append(createMessage({ text: 'Test' }));
      const messages = await store.getRecent();
      expect(messages).toHaveLength(1);
      expect(messages[0].text).toBe('Test');
    });

    it('respects maxMessages limit', async () => {
      const limitedStore = new MemoryStore({ maxMessages: 3 });
      
      for (let i = 0; i < 5; i++) {
        await limitedStore.append(createMessage({ text: `Message ${i}` }));
      }
      
      const messages = await limitedStore.getRecent();
      expect(messages).toHaveLength(3);
      // Should keep the most recent messages
      expect(messages.map(m => m.text)).toEqual(['Message 2', 'Message 3', 'Message 4']);
    });

    it('uses default maxMessages of 100', async () => {
      for (let i = 0; i < 110; i++) {
        await store.append(createMessage({ text: `Message ${i}` }));
      }
      
      const messages = await store.getRecent();
      expect(messages).toHaveLength(100);
    });
  });

  describe('getRecent', () => {
    it('returns empty array when no messages', async () => {
      const messages = await store.getRecent();
      expect(messages).toEqual([]);
    });

    it('returns messages in order', async () => {
      await store.append(createMessage({ text: 'First' }));
      await store.append(createMessage({ text: 'Second' }));
      await store.append(createMessage({ text: 'Third' }));
      
      const messages = await store.getRecent();
      expect(messages.map(m => m.text)).toEqual(['First', 'Second', 'Third']);
    });

    it('respects limit parameter', async () => {
      for (let i = 0; i < 10; i++) {
        await store.append(createMessage({ text: `Message ${i}` }));
      }
      
      const messages = await store.getRecent(3);
      expect(messages).toHaveLength(3);
      // Should return the 3 most recent
      expect(messages.map(m => m.text)).toEqual(['Message 7', 'Message 8', 'Message 9']);
    });

    it('filters by workspaceId when provided', async () => {
      await store.append(createMessage({ text: 'WS1 Message 1', workspaceId: 'workspace-1' }));
      await store.append(createMessage({ text: 'WS2 Message 1', workspaceId: 'workspace-2' }));
      await store.append(createMessage({ text: 'WS1 Message 2', workspaceId: 'workspace-1' }));
      
      const ws1Messages = await store.getRecent(10, 'workspace-1');
      expect(ws1Messages).toHaveLength(2);
      expect(ws1Messages.map(m => m.text)).toEqual(['WS1 Message 1', 'WS1 Message 2']);

      const ws2Messages = await store.getRecent(10, 'workspace-2');
      expect(ws2Messages).toHaveLength(1);
      expect(ws2Messages[0].text).toBe('WS2 Message 1');
    });

    it('returns all messages when workspaceId is not provided', async () => {
      await store.append(createMessage({ text: 'WS1 Message', workspaceId: 'workspace-1' }));
      await store.append(createMessage({ text: 'WS2 Message', workspaceId: 'workspace-2' }));
      
      const allMessages = await store.getRecent();
      expect(allMessages).toHaveLength(2);
    });
  });

  describe('clear', () => {
    it('removes all messages', async () => {
      await store.append(createMessage({ text: 'Message 1' }));
      await store.append(createMessage({ text: 'Message 2' }));
      
      await store.clear();
      
      const messages = await store.getRecent();
      expect(messages).toEqual([]);
    });

    it('is safe to call on empty store', async () => {
      await expect(store.clear()).resolves.not.toThrow();
    });
  });

  describe('getRecentBySession', () => {
    it('filters messages by sessionId', async () => {
      await store.append(createMessage({ text: 'Session A msg 1', sessionId: 'session-a' }));
      await store.append(createMessage({ text: 'Session B msg 1', sessionId: 'session-b' }));
      await store.append(createMessage({ text: 'Session A msg 2', sessionId: 'session-a' }));

      const sessionAMessages = await store.getRecentBySession(10, 'session-a');
      expect(sessionAMessages).toHaveLength(2);
      expect(sessionAMessages.map(m => m.text)).toEqual(['Session A msg 1', 'Session A msg 2']);

      const sessionBMessages = await store.getRecentBySession(10, 'session-b');
      expect(sessionBMessages).toHaveLength(1);
      expect(sessionBMessages[0].text).toBe('Session B msg 1');
    });

    it('returns empty array for non-existent session', async () => {
      await store.append(createMessage({ text: 'Session A msg', sessionId: 'session-a' }));

      const messages = await store.getRecentBySession(10, 'non-existent');
      expect(messages).toEqual([]);
    });

    it('respects limit parameter', async () => {
      for (let i = 0; i < 10; i++) {
        await store.append(createMessage({ text: `Message ${i}`, sessionId: 'session-a' }));
      }

      const messages = await store.getRecentBySession(3, 'session-a');
      expect(messages).toHaveLength(3);
      expect(messages.map(m => m.text)).toEqual(['Message 7', 'Message 8', 'Message 9']);
    });
  });
});
