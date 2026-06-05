import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  sendKioskAttentionIfValid,
  KIOSK_ATTENTION_TTL_MS,
  type KioskAttentionRegistry,
} from './index.js';

/**
 * Defensive-guard tests for sendKioskAttentionIfValid (PR #396 review feedback).
 *
 * The helper exists to make sure a mobile client cannot trick the server into
 * broadcasting a `kiosk-attention` banner to anything that is not a registered
 * kiosk. The previous inline block trusted `message.targetKioskDeviceId` on
 * faith — harmless because mobiles don't subscribe to `kiosk-attention`, but
 * the intent was implicit. This helper makes the contract explicit and asserts
 * it under unit test.
 */
describe('sendKioskAttentionIfValid', () => {
  let sendToDevice: ReturnType<typeof vi.fn<KioskAttentionRegistry['sendToDevice']>>;
  let getDevice: ReturnType<typeof vi.fn<KioskAttentionRegistry['getDevice']>>;
  let registry: KioskAttentionRegistry;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    sendToDevice = vi.fn<KioskAttentionRegistry['sendToDevice']>().mockReturnValue(true);
    getDevice = vi.fn<KioskAttentionRegistry['getDevice']>();
    registry = { getDevice, sendToDevice };
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('sends attention when sender is mobile and target is a kiosk', () => {
    getDevice.mockReturnValue({ mode: 'kiosk' });

    const sent = sendKioskAttentionIfValid(registry, {
      senderMode: 'mobile',
      senderDeviceId: 'mobile-1',
      senderDisplayName: 'Phone A',
      targetKioskDeviceId: 'kiosk-1',
    });

    expect(sent).toBe(true);
    expect(sendToDevice).toHaveBeenCalledTimes(1);
    expect(sendToDevice).toHaveBeenCalledWith('kiosk-1', {
      type: 'kiosk-attention',
      mobileDeviceId: 'mobile-1',
      mobileDisplayName: 'Phone A',
      ttlMs: KIOSK_ATTENTION_TTL_MS,
    });
  });

  it('drops the message when the target is another mobile (defensive guard)', () => {
    // Mobile-2 is registered as a mobile, not a kiosk. A buggy or malicious
    // mobile-1 should NOT be able to make the server broadcast attention to it.
    getDevice.mockReturnValue({ mode: 'mobile' });

    const sent = sendKioskAttentionIfValid(registry, {
      senderMode: 'mobile',
      senderDeviceId: 'mobile-1',
      senderDisplayName: 'Phone A',
      targetKioskDeviceId: 'mobile-2',
    });

    expect(sent).toBe(false);
    expect(sendToDevice).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('kiosk-attention dropped')
    );
  });

  it('drops the message when the target device is not registered (offline kiosk / stale id)', () => {
    getDevice.mockReturnValue(undefined);

    const sent = sendKioskAttentionIfValid(registry, {
      senderMode: 'mobile',
      senderDeviceId: 'mobile-1',
      senderDisplayName: 'Phone A',
      targetKioskDeviceId: 'kiosk-ghost',
    });

    expect(sent).toBe(false);
    expect(sendToDevice).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
  });

  it('is a no-op when the sender is itself a kiosk', () => {
    // Kiosks register against their own per-kiosk session; they should never
    // try to nudge anything via this path.
    getDevice.mockReturnValue({ mode: 'kiosk' });

    const sent = sendKioskAttentionIfValid(registry, {
      senderMode: 'kiosk',
      senderDeviceId: 'kiosk-1',
      senderDisplayName: 'Kitchen Kiosk',
      targetKioskDeviceId: 'kiosk-2',
    });

    expect(sent).toBe(false);
    expect(getDevice).not.toHaveBeenCalled();
    expect(sendToDevice).not.toHaveBeenCalled();
  });

  it('is a no-op when targetKioskDeviceId is missing (legacy workspace-wide flow)', () => {
    const sent = sendKioskAttentionIfValid(registry, {
      senderMode: 'mobile',
      senderDeviceId: 'mobile-1',
      senderDisplayName: 'Phone A',
      targetKioskDeviceId: undefined,
    });

    expect(sent).toBe(false);
    expect(getDevice).not.toHaveBeenCalled();
    expect(sendToDevice).not.toHaveBeenCalled();
  });

  it('is a no-op when target equals sender (self-target paranoia)', () => {
    const sent = sendKioskAttentionIfValid(registry, {
      senderMode: 'mobile',
      senderDeviceId: 'mobile-1',
      senderDisplayName: 'Phone A',
      targetKioskDeviceId: 'mobile-1',
    });

    expect(sent).toBe(false);
    expect(getDevice).not.toHaveBeenCalled();
    expect(sendToDevice).not.toHaveBeenCalled();
  });
});
