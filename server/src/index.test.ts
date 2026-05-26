import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getAuthConfig } from './index.js';

/**
 * Behavioral tests for getAuthConfig() — the 6-scenario acceptance-criteria
 * table from issue #336.
 *
 * Rules under test (issue #336):
 *   - Test mode requires *all three* GitHub vars to be missing simultaneously
 *     (predicate uses && over the three negations, not ||).
 *   - "Some set, some missing" is always a fail-fast error, regardless of
 *     whether TEST_AUTH_SECRET is set. The error message must name the
 *     specific missing var(s).
 *   - The 'test-mode-placeholder' string can therefore never leak into an
 *     AuthConfig that any partial-config caller would receive.
 */
describe('getAuthConfig (issue #336)', () => {
  const envKeys = [
    'GITHUB_CLIENT_ID',
    'GITHUB_CLIENT_SECRET',
    'GITHUB_APP_SLUG',
    'JWT_SECRET',
    'TEST_AUTH_SECRET',
    'JWT_EXPIRES_IN',
    'BASE_URL',
    'PORT',
  ] as const;

  let originalEnv: Partial<Record<(typeof envKeys)[number], string | undefined>>;

  beforeEach(() => {
    originalEnv = {};
    for (const key of envKeys) {
      originalEnv[key] = process.env[key];
      delete process.env[key];
    }
    // Quiet the informational logs the function emits in success paths.
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    for (const key of envKeys) {
      const original = originalEnv[key];
      if (original === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = original;
      }
    }
    vi.restoreAllMocks();
  });

  // Row 1: JWT_SECRET missing → null (regardless of every other var).
  it('returns null when JWT_SECRET is missing (even with full GitHub config)', () => {
    process.env.GITHUB_CLIENT_ID = 'cid';
    process.env.GITHUB_CLIENT_SECRET = 'csecret';
    process.env.GITHUB_APP_SLUG = 'slug';
    process.env.TEST_AUTH_SECRET = 'tsecret';
    // JWT_SECRET deliberately unset.

    expect(getAuthConfig()).toBeNull();
  });

  // Row 2: JWT_SECRET + all three GitHub vars set → full AuthConfig.
  it('returns full AuthConfig when JWT_SECRET and all three GitHub vars are set', () => {
    process.env.JWT_SECRET = 'jwt';
    process.env.GITHUB_CLIENT_ID = 'cid';
    process.env.GITHUB_CLIENT_SECRET = 'csecret';
    process.env.GITHUB_APP_SLUG = 'my-app';

    const cfg = getAuthConfig();
    expect(cfg).not.toBeNull();
    expect(cfg).toMatchObject({
      githubClientId: 'cid',
      githubClientSecret: 'csecret',
      githubAppSlug: 'my-app',
      jwtSecret: 'jwt',
    });
    // Critically: no placeholder leakage on the happy path.
    expect(cfg!.githubClientId).not.toBe('test-mode-placeholder');
    expect(cfg!.githubClientSecret).not.toBe('test-mode-placeholder');
    expect(cfg!.githubAppSlug).not.toBe('test-mode-placeholder');
  });

  // Row 3: JWT_SECRET + TEST_AUTH_SECRET set, NO GitHub vars → placeholder AuthConfig.
  it('returns AuthConfig with placeholder values when no GitHub vars set but TEST_AUTH_SECRET is set', () => {
    process.env.JWT_SECRET = 'jwt';
    process.env.TEST_AUTH_SECRET = 'tsecret';
    // All three GitHub vars deliberately unset.

    const cfg = getAuthConfig();
    expect(cfg).not.toBeNull();
    expect(cfg).toMatchObject({
      githubClientId: 'test-mode-placeholder',
      githubClientSecret: 'test-mode-placeholder',
      githubAppSlug: 'test-mode-placeholder',
      jwtSecret: 'jwt',
    });
  });

  // Row 4: JWT_SECRET set, no GitHub vars, no TEST_AUTH_SECRET → null (auth disabled).
  it('returns null when JWT_SECRET set but no GitHub vars and no TEST_AUTH_SECRET', () => {
    process.env.JWT_SECRET = 'jwt';
    // No GITHUB_* and no TEST_AUTH_SECRET.

    expect(getAuthConfig()).toBeNull();
  });

  // Row 5: partial GitHub config without TEST_AUTH_SECRET → throws naming missing vars.
  it('throws on partial GitHub config (no TEST_AUTH_SECRET), naming the missing var', () => {
    process.env.JWT_SECRET = 'jwt';
    process.env.GITHUB_CLIENT_ID = 'cid';
    process.env.GITHUB_CLIENT_SECRET = 'csecret';
    // GITHUB_APP_SLUG missing.

    expect(() => getAuthConfig()).toThrow(/Incomplete GitHub App configuration/);
    expect(() => getAuthConfig()).toThrow(/GITHUB_APP_SLUG/);
    // Sanity: it should NOT name the vars that are set.
    expect(() => getAuthConfig()).not.toThrow(/GITHUB_CLIENT_ID/);
    expect(() => getAuthConfig()).not.toThrow(/GITHUB_CLIENT_SECRET/);
  });

  // Row 6: partial GitHub config WITH TEST_AUTH_SECRET → still throws (no placeholder substitution).
  it('throws on partial GitHub config even when TEST_AUTH_SECRET is set, naming the missing vars', () => {
    process.env.JWT_SECRET = 'jwt';
    process.env.TEST_AUTH_SECRET = 'tsecret';
    process.env.GITHUB_CLIENT_ID = 'cid';
    // GITHUB_CLIENT_SECRET and GITHUB_APP_SLUG missing.

    expect(() => getAuthConfig()).toThrow(/Incomplete GitHub App configuration/);
    expect(() => getAuthConfig()).toThrow(/GITHUB_CLIENT_SECRET/);
    expect(() => getAuthConfig()).toThrow(/GITHUB_APP_SLUG/);
    expect(() => getAuthConfig()).not.toThrow(/GITHUB_CLIENT_ID/);
  });
});
