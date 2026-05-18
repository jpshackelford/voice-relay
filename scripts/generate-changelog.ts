#!/usr/bin/env npx tsx
/**
 * Generate changelog from deploy-success-* tags and conventional commits.
 *
 * Usage: npx tsx scripts/generate-changelog.ts
 *
 * Outputs: server/changelog.json
 *
 * This script runs at build time to generate static changelog data that
 * the server serves via /api/changelog.
 */

import { execSync } from 'child_process';
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface Change {
  type: 'feat' | 'fix';
  scope?: string;
  description: string;
}

interface ChangelogEntry {
  commit: string; // Short SHA
  deployedAt: string; // ISO timestamp
  changes: Change[];
  isLegacy?: boolean; // True for pre-tag entries from seed file
}

interface Changelog {
  generatedAt: string;
  entries: ChangelogEntry[];
}

interface SeedFile {
  entries: ChangelogEntry[];
}

/**
 * Parse a conventional commit message.
 * Format: type(scope): description  or  type: description
 */
function parseCommitMessage(message: string): Change | null {
  // Match: feat(mobile): description  or  fix: description
  const match = message.match(/^(feat|fix)(?:\(([^)]+)\))?:\s*(.+)$/i);
  if (!match) return null;

  const [, type, scope, description] = match;

  // Clean up description: remove PR references like (#123)
  let cleanDesc = description.replace(/\s*\(#\d+\)\s*$/, '').trim();
  // Capitalize first letter
  cleanDesc = cleanDesc.charAt(0).toUpperCase() + cleanDesc.slice(1);

  return {
    type: type.toLowerCase() as 'feat' | 'fix',
    scope: scope || undefined,
    description: cleanDesc,
  };
}

/**
 * Validate that a git ref name contains only safe characters.
 * Defense-in-depth against command injection even though tags come from git.
 */
function isValidRefName(ref: string): boolean {
  // Only allow alphanumeric, hyphens, underscores, dots, and forward slashes
  return /^[a-zA-Z0-9._/-]+$/.test(ref);
}

/**
 * Execute a git command and return trimmed stdout.
 */
function git(args: string): string {
  try {
    return execSync(`git ${args}`, {
      encoding: 'utf-8',
      cwd: join(__dirname, '..'),
      maxBuffer: 10 * 1024 * 1024, // 10MB for large histories
    }).trim();
  } catch (error) {
    console.error(`Git command failed: git ${args}`);
    throw error;
  }
}

/**
 * Get all deploy-success-* tags sorted by date (newest first).
 */
function getDeployTags(): string[] {
  try {
    const output = git("tag -l 'deploy-success-*' --sort=-creatordate");
    if (!output) return [];
    return output.split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Get the date of a tag in ISO format.
 */
function getTagDate(tag: string): string {
  // Validate tag name to prevent command injection
  if (!isValidRefName(tag)) {
    console.warn(`Skipping invalid tag name: ${tag}`);
    return new Date().toISOString();
  }
  try {
    // Get tag's commit date in ISO format
    const date = git(`for-each-ref --format='%(creatordate:iso-strict)' -- refs/tags/${tag}`);
    // Remove any timezone suffix and ensure UTC format
    const parsed = new Date(date);
    return parsed.toISOString();
  } catch {
    return new Date().toISOString();
  }
}

/**
 * Get the short SHA from a tag name.
 */
function getShortSha(tag: string): string {
  // Tag format: deploy-success-<full-sha>
  const sha = tag.replace('deploy-success-', '');
  return sha.substring(0, 7);
}

/**
 * Get commits between two tags (exclusive of the older tag).
 */
function getCommitsBetween(newerTag: string, olderTag: string | null): string[] {
  // Validate tag names to prevent command injection
  if (!isValidRefName(newerTag)) {
    console.warn(`Skipping invalid tag name: ${newerTag}`);
    return [];
  }
  if (olderTag && !isValidRefName(olderTag)) {
    console.warn(`Skipping invalid tag name: ${olderTag}`);
    return [];
  }
  try {
    const range = olderTag ? `${olderTag}..${newerTag}` : newerTag;
    // Get commit messages (validation above ensures safe ref names)
    const output = git(`log --pretty=format:"%s" ${range}`);
    if (!output) return [];
    return output.split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Load seed entries from changelog-seed.json for pre-tag history.
 */
function loadSeedEntries(): ChangelogEntry[] {
  const seedPath = join(__dirname, 'changelog-seed.json');
  if (!existsSync(seedPath)) {
    return [];
  }

  try {
    const seedData = JSON.parse(readFileSync(seedPath, 'utf-8')) as SeedFile;
    console.log(`Loaded ${seedData.entries.length} seed entries from changelog-seed.json`);
    return seedData.entries;
  } catch (error) {
    console.warn('Failed to load changelog-seed.json:', error);
    return [];
  }
}

/**
 * Generate changelog from git history.
 */
function generateChangelog(): Changelog {
  const tags = getDeployTags();

  if (tags.length === 0) {
    console.log('No deploy-success-* tags found');
    // Still load seed entries even without tags
    const seedEntries = loadSeedEntries();
    return {
      generatedAt: new Date().toISOString(),
      entries: seedEntries,
    };
  }

  console.log(`Found ${tags.length} deploy tags`);

  // Process ALL tags (no arbitrary limit)
  // Stop before the last tag to ensure we always have a boundary
  const entries: ChangelogEntry[] = [];

  for (let i = 0; i < tags.length - 1; i++) {
    const currentTag = tags[i];
    const previousTag = tags[i + 1]; // Always defined since we stop before last

    const commits = getCommitsBetween(currentTag, previousTag);
    const changes: Change[] = [];

    for (const message of commits) {
      const parsed = parseCommitMessage(message);
      if (parsed) {
        changes.push(parsed);
      }
    }

    // Only include releases that have user-facing changes (feat or fix)
    if (changes.length > 0) {
      entries.push({
        commit: getShortSha(currentTag),
        deployedAt: getTagDate(currentTag),
        changes,
      });
    }
  }

  console.log(`Generated ${entries.length} changelog entries with user-facing changes from tags`);

  // Merge with seed entries for pre-tag history
  const seedEntries = loadSeedEntries();
  if (seedEntries.length > 0) {
    // Deduplicate by commit SHA
    const existingCommits = new Set(entries.map((e) => e.commit));
    const uniqueSeedEntries = seedEntries.filter((e) => !existingCommits.has(e.commit));
    console.log(`Adding ${uniqueSeedEntries.length} unique seed entries`);
    entries.push(...uniqueSeedEntries);
  }

  // Sort entries by deployedAt (newest first)
  entries.sort((a, b) => new Date(b.deployedAt).getTime() - new Date(a.deployedAt).getTime());

  console.log(`Total changelog entries: ${entries.length}`);

  return {
    generatedAt: new Date().toISOString(),
    entries,
  };
}

/**
 * Main entry point
 */
function main() {
  console.log('Generating changelog from git history...');

  const changelog = generateChangelog();

  // Ensure server directory exists
  const outputDir = join(__dirname, '..', 'server');
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const outputPath = join(outputDir, 'changelog.json');
  writeFileSync(outputPath, JSON.stringify(changelog, null, 2));
  console.log(`Wrote changelog to ${outputPath}`);

  // Also log a sample entry for verification
  if (changelog.entries.length > 0) {
    console.log('\nMost recent entry:');
    console.log(JSON.stringify(changelog.entries[0], null, 2));
  }
}

main();
