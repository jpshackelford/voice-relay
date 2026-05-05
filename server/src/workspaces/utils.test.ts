import { describe, it, expect } from 'vitest';
import { 
  generateSlug, 
  makeSlugUnique, 
  generateJoinCode, 
  isValidSlug, 
  isValidWorkspaceName 
} from './utils.js';

describe('generateSlug', () => {
  it('converts to lowercase', () => {
    expect(generateSlug('My Workspace')).toBe('my-workspace');
  });

  it('replaces spaces with hyphens', () => {
    expect(generateSlug('hello world test')).toBe('hello-world-test');
  });

  it('removes special characters', () => {
    expect(generateSlug('Test! @Workspace# 123')).toBe('test-workspace-123');
  });

  it('collapses multiple hyphens', () => {
    expect(generateSlug('hello---world')).toBe('hello-world');
  });

  it('trims leading/trailing hyphens', () => {
    expect(generateSlug('  -hello world-  ')).toBe('hello-world');
  });

  it('handles empty string', () => {
    expect(generateSlug('')).toBe('');
  });
});

describe('makeSlugUnique', () => {
  it('appends a random suffix', () => {
    const unique = makeSlugUnique('test-slug');
    expect(unique).toMatch(/^test-slug-[a-f0-9]{6}$/);
  });

  it('generates different suffixes each time', () => {
    const first = makeSlugUnique('test');
    const second = makeSlugUnique('test');
    expect(first).not.toBe(second);
  });
});

describe('generateJoinCode', () => {
  it('generates code in correct format', () => {
    const code = generateJoinCode();
    expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  });

  it('generates unique codes', () => {
    const codes = new Set<string>();
    for (let i = 0; i < 100; i++) {
      codes.add(generateJoinCode());
    }
    expect(codes.size).toBe(100);
  });

  it('only uses distinguishable characters', () => {
    // Test many codes to ensure no confusing chars
    for (let i = 0; i < 50; i++) {
      const code = generateJoinCode();
      expect(code).not.toMatch(/[0OIl1]/);
    }
  });
});

describe('isValidSlug', () => {
  it('accepts valid slugs', () => {
    expect(isValidSlug('a')).toBe(true);
    expect(isValidSlug('test')).toBe(true);
    expect(isValidSlug('my-workspace')).toBe(true);
    expect(isValidSlug('test-123')).toBe(true);
    expect(isValidSlug('a1')).toBe(true);
  });

  it('rejects invalid slugs', () => {
    expect(isValidSlug('')).toBe(false);
    expect(isValidSlug('-test')).toBe(false);
    expect(isValidSlug('test-')).toBe(false);
    expect(isValidSlug('TEST')).toBe(false);
    expect(isValidSlug('test_slug')).toBe(false);
    expect(isValidSlug('test slug')).toBe(false);
  });
});

describe('isValidWorkspaceName', () => {
  it('accepts valid names', () => {
    expect(isValidWorkspaceName('a')).toBe(true);
    expect(isValidWorkspaceName('My Workspace')).toBe(true);
    expect(isValidWorkspaceName('Test 123!')).toBe(true);
  });

  it('rejects invalid names', () => {
    expect(isValidWorkspaceName('')).toBe(false);
    expect(isValidWorkspaceName('   ')).toBe(false);
    expect(isValidWorkspaceName('a'.repeat(256))).toBe(false);
  });
});
