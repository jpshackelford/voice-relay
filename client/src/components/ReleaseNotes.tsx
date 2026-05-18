import { useState, useEffect, useCallback } from 'react';
import { getRelativeTime, formatAbsoluteTime, isWithinDuration } from '../utils/relativeTime';

interface Change {
  type: 'feat' | 'fix';
  scope?: string;
  description: string;
  prNumber?: number;
}

interface ChangelogEntry {
  commit: string;
  deployedAt: string;
  changes: Change[];
}

interface Changelog {
  generatedAt: string;
  entries: ChangelogEntry[];
}

interface ReleaseNotesProps {
  isOpen: boolean;
  onClose: () => void;
}

const CACHE_KEY = 'voice-relay-changelog';
const CACHE_DURATION = 3600000; // 1 hour in ms
const AUTO_REFRESH_INTERVAL = 60000; // 1 minute for recent entries

/**
 * Release notes modal displaying recent deployments and changes.
 * Fetches changelog from /api/changelog with caching.
 */
export function ReleaseNotes({ isOpen, onClose }: ReleaseNotesProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [changelog, setChangelog] = useState<Changelog | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedTimestamp, setExpandedTimestamp] = useState<string | null>(null);
  const [, setRefreshKey] = useState(0); // For triggering re-renders

  // Fetch changelog from server with caching
  const fetchChangelog = useCallback(async () => {
    // Check localStorage cache first
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        const { data, timestamp } = JSON.parse(cached);
        if (Date.now() - timestamp < CACHE_DURATION) {
          setChangelog(data);
          return;
        }
      }
    } catch {
      // Cache read failed, proceed to fetch
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/changelog');
      if (!response.ok) {
        throw new Error(`Failed to fetch changelog: ${response.status}`);
      }
      const data: Changelog = await response.json();
      setChangelog(data);

      // Cache the result
      try {
        localStorage.setItem(
          CACHE_KEY,
          JSON.stringify({ data, timestamp: Date.now() })
        );
      } catch {
        // Cache write failed (storage full), ignore
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load changelog');
    } finally {
      setLoading(false);
    }
  }, []);

  // Handle visibility animation
  useEffect(() => {
    if (isOpen) {
      setIsVisible(true);
      fetchChangelog();
    } else {
      const timer = setTimeout(() => setIsVisible(false), 200);
      return () => clearTimeout(timer);
    }
  }, [isOpen, fetchChangelog]);

  // Auto-refresh relative times for recent entries
  useEffect(() => {
    if (!isOpen || !changelog) return;

    // Check if any entry is recent enough to need refresh
    const hasRecentEntry = changelog.entries.some((entry) =>
      isWithinDuration(entry.deployedAt, 3600000) // Within 1 hour
    );

    if (!hasRecentEntry) return;

    const interval = setInterval(() => {
      setRefreshKey((k) => k + 1);
    }, AUTO_REFRESH_INTERVAL);

    return () => clearInterval(interval);
  }, [isOpen, changelog]);

  // Toggle timestamp display
  const toggleTimestamp = (deployedAt: string) => {
    setExpandedTimestamp(expandedTimestamp === deployedAt ? null : deployedAt);
  };

  if (!isVisible) return null;

  return (
    <div
      className={`release-notes-overlay ${isOpen ? 'open' : ''}`}
      onClick={onClose}
    >
      <div
        className={`release-notes-modal ${isOpen ? 'open' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="release-notes-header">
          <button className="release-notes-back" onClick={onClose}>
            ← Back
          </button>
          <h3>What's New</h3>
        </div>

        <div className="release-notes-content">
          {loading && (
            <div className="release-notes-loading">Loading changelog...</div>
          )}

          {error && (
            <div className="release-notes-error">
              <p>Unable to load changelog</p>
              <button onClick={fetchChangelog}>Retry</button>
            </div>
          )}

          {!loading && !error && changelog && changelog.entries.length === 0 && (
            <div className="release-notes-empty">
              <p>No releases yet</p>
            </div>
          )}

          {!loading && !error && changelog && changelog.entries.length > 0 && (
            <div className="release-notes-list">
              {changelog.entries.map((entry) => (
                <div key={entry.commit} className="release-entry">
                  <div
                    className="release-header"
                    onClick={() => toggleTimestamp(entry.deployedAt)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        toggleTimestamp(entry.deployedAt);
                      }
                    }}
                  >
                    <span className="release-version">📦 {entry.commit}</span>
                    <span className="release-timestamp">
                      {expandedTimestamp === entry.deployedAt
                        ? formatAbsoluteTime(entry.deployedAt)
                        : getRelativeTime(entry.deployedAt)}
                    </span>
                  </div>
                  <ul className="release-changes">
                    {entry.changes.map((change, idx) => (
                      <li key={idx} className={`change-${change.type}`}>
                        <span className="change-icon">
                          {change.type === 'feat' ? '✨' : '🐛'}
                        </span>
                        <span className="change-text">
                          {change.scope && (
                            <span className="change-scope">{change.scope}:</span>
                          )}{' '}
                          {change.description}
                          {change.prNumber && (
                            <a
                              href={`https://github.com/jpshackelford/voice-relay/pull/${change.prNumber}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="change-pr-link"
                              onClick={(e) => e.stopPropagation()}
                            >
                              #{change.prNumber}
                            </a>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
