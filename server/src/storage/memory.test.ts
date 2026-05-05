import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryStore } from './memory.js';
import type { RelayedTextMessage } from '../types.js';

describe('MemoryStore', () => {
  let store: MemoryStore;

  const createMessage = (overrides: Partial<RelayedTextMessage> = {}): RelayedTextMessage => ({
    type: 'text',
    utteranceId: `utt-${Date.now()}`,
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
});
