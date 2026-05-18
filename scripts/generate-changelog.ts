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
import { writeFileSync, mkdirSync, existsSync } from 'fs';
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
}

interface Changelog {
  generatedAt: string;
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
  try {
    // Get tag's commit date in ISO format
    const date = git(`for-each-ref --format='%(creatordate:iso-strict)' refs/tags/${tag}`);
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
  try {
    const range = olderTag ? `${olderTag}..${newerTag}` : newerTag;
    // Get commit messages with short hash
    const output = git(`log --pretty=format:"%s" ${range}`);
    if (!output) return [];
    return output.split('\n').filter(Boolean);
  } catch {
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
    return {
      generatedAt: new Date().toISOString(),
      entries: [],
    };
  }

  console.log(`Found ${tags.length} deploy tags`);

  // Limit to 20 most recent releases
  const recentTags = tags.slice(0, 20);
  const entries: ChangelogEntry[] = [];

  for (let i = 0; i < recentTags.length; i++) {
    const currentTag = recentTags[i];
    const previousTag = recentTags[i + 1] || null;

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

  console.log(`Generated ${entries.length} changelog entries with user-facing changes`);

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
