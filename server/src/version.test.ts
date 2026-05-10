import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { loadVersionInfo } from './version.js';

describe('loadVersionInfo', () => {
  let testDir: string;

  beforeEach(() => {
    // Create a unique temp directory for each test
    testDir = join(tmpdir(), `version-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up temp directory
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('returns dev fallback when version.json does not exist', () => {
    const result = loadVersionInfo(testDir);

    expect(result).toEqual({
      commit: 'dev',
      deployedAt: null,
    });
  });

  it('loads commit and deployedAt from valid version.json', () => {
    const versionData = {
      commit: 'abc1234',
      deployedAt: '2026-05-10T10:30:00Z',
    };
    writeFileSync(join(testDir, 'version.json'), JSON.stringify(versionData));

    const result = loadVersionInfo(testDir);

    expect(result).toEqual({
      commit: 'abc1234',
      deployedAt: '2026-05-10T10:30:00Z',
    });
  });

  it('returns unknown for missing commit in version.json', () => {
    const versionData = {
      deployedAt: '2026-05-10T10:30:00Z',
    };
    writeFileSync(join(testDir, 'version.json'), JSON.stringify(versionData));

    const result = loadVersionInfo(testDir);

    expect(result).toEqual({
      commit: 'unknown',
      deployedAt: '2026-05-10T10:30:00Z',
    });
  });

  it('returns null for missing deployedAt in version.json', () => {
    const versionData = {
      commit: 'def5678',
    };
    writeFileSync(join(testDir, 'version.json'), JSON.stringify(versionData));

    const result = loadVersionInfo(testDir);

    expect(result).toEqual({
      commit: 'def5678',
      deployedAt: null,
    });
  });

  it('returns dev fallback for invalid JSON', () => {
    writeFileSync(join(testDir, 'version.json'), 'not valid json {{{');

    const result = loadVersionInfo(testDir);

    expect(result).toEqual({
      commit: 'dev',
      deployedAt: null,
    });
  });

  it('returns dev fallback for empty file', () => {
    writeFileSync(join(testDir, 'version.json'), '');

    const result = loadVersionInfo(testDir);

    expect(result).toEqual({
      commit: 'dev',
      deployedAt: null,
    });
  });

  it('handles empty object in version.json', () => {
    writeFileSync(join(testDir, 'version.json'), '{}');

    const result = loadVersionInfo(testDir);

    expect(result).toEqual({
      commit: 'unknown',
      deployedAt: null,
    });
  });

  it('handles empty string commit value', () => {
    const versionData = {
      commit: '',
      deployedAt: '2026-05-10T10:30:00Z',
    };
    writeFileSync(join(testDir, 'version.json'), JSON.stringify(versionData));

    const result = loadVersionInfo(testDir);

    // Empty string is falsy, so it becomes 'unknown'
    expect(result).toEqual({
      commit: 'unknown',
      deployedAt: '2026-05-10T10:30:00Z',
    });
  });

  it('uses default path when basePath not provided', () => {
    // This tests the default behavior - without a valid version.json in the server root,
    // it should return the dev fallback
    const result = loadVersionInfo();

    expect(result.commit).toBe('dev');
    expect(result.deployedAt).toBeNull();
  });
});
