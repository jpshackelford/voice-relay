import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface VersionInfo {
  commit: string;
  deployedAt: string | null;
}

/**
 * Loads version information from version.json file.
 * Falls back to { commit: 'dev', deployedAt: null } if file doesn't exist or is invalid.
 * 
 * @param basePath - Optional base path for testing. Defaults to server root.
 */
export function loadVersionInfo(basePath?: string): VersionInfo {
  try {
    const versionPath = basePath
      ? join(basePath, 'version.json')
      : join(__dirname, '../../version.json');
    const content = readFileSync(versionPath, 'utf-8');
    const data = JSON.parse(content);
    return {
      commit: data.commit || 'unknown',
      deployedAt: data.deployedAt || null,
    };
  } catch {
    // version.json doesn't exist in dev or if deployment failed to generate it
    return { commit: 'dev', deployedAt: null };
  }
}
