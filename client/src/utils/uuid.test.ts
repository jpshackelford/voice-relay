import { describe, it, expect, afterEach, vi } from 'vitest';
import { generateUUID } from './uuid';

/**
 * Some happy-dom builds expose `crypto.randomUUID` as a non-configurable
 * accessor, so we toggle it by reassigning the value rather than deleting
 * the property. `generateUUID` only inspects truthiness, so undefined is
 * sufficient to drive the fallback branch.
 */
function withoutRandomUUID<T>(fn: () => T): T {
  const original = (crypto as { randomUUID?: () => string }).randomUUID;
  (crypto as { randomUUID?: unknown }).randomUUID = undefined;
  try {
    return fn();
  } finally {
    (crypto as { randomUUID?: unknown }).randomUUID = original;
  }
}

describe('generateUUID', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses crypto.randomUUID when available', () => {
    const stubbed = '00000000-0000-4000-8000-000000000000';
    const spy = vi
      .spyOn(crypto, 'randomUUID')
      .mockReturnValue(stubbed as `${string}-${string}-${string}-${string}-${string}`);

    const result = generateUUID();

    expect(spy).toHaveBeenCalledTimes(1);
    expect(result).toBe(stubbed);
  });

  it('returns a v4-shaped UUID via fallback when crypto.randomUUID is unavailable', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const result = withoutRandomUUID(() => generateUUID());

    // Format: 8-4-4-4-12 hex digits with version 4 nibble and variant y in {8,9,a,b}.
    expect(result).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('fallback produces variant-correct y nibble for a high random value', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999);

    const result = withoutRandomUUID(() => generateUUID());

    const y = result.split('-')[3][0];
    expect(['8', '9', 'a', 'b']).toContain(y);
    expect(result[14]).toBe('4'); // version nibble
  });

  it('generates distinct UUIDs across calls when fallback uses real randomness', () => {
    const [a, b] = withoutRandomUUID(() => [generateUUID(), generateUUID()] as const);
    expect(a).not.toBe(b);
  });
});
