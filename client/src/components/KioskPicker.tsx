import { useMemo } from 'react';
import type { DeviceInfo, DisplayContent } from '../types';

/**
 * Issue #393: kiosk picker shown on Mobile when the workspace has ≥2
 * kiosks connected and no `targetKioskDeviceId` has been chosen yet.
 *
 * The picker is a deliberately small, dependency-free component because
 * it lives in the cold-start path. It does *not* fetch anything; the
 * server enriches each kiosk in the `device-list` broadcast with
 * `activeSessionId` and `lastUsedAt`. We render three call-outs per
 * card:
 *   - 🖥️ <displayName>  (always)
 *   - 🔴 In session     (when activeSessionId is non-null)
 *   - last used <relative>  (when lastUsedAt is non-null)
 *
 * The picker is *only* shown when at least two kiosks are present
 * (issue requirement). With exactly one kiosk, the picker is skipped
 * and the mobile auto-targets it via the parent setter.
 */
export interface KioskPickerProps {
  /** Kiosk DeviceInfo entries from the `device-list` broadcast. */
  kiosks: DeviceInfo[];
  /** Currently selected kiosk id, if any. */
  selectedKioskId?: string;
  /** Fired when the user picks a kiosk. */
  onSelect: (kioskDeviceId: string) => void;
  /** Latest display content from any kiosk — rendered as a thumbnail. */
  displayContent?: DisplayContent | null;
}

/** "5m ago", "2h ago", "yesterday" — tiny relative-time helper. */
function relativeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 'recently';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function DisplayPreview({ content }: { content: DisplayContent | null | undefined }) {
  if (!content) return null;
  if (content.type === 'image' && content.content) {
    return (
      <img
        className="kiosk-picker-preview kiosk-picker-preview-image"
        src={content.content}
        alt={content.title ?? 'Kiosk display'}
        data-testid="kiosk-picker-preview"
      />
    );
  }
  if (content.type === 'markdown' && (content.title || content.content)) {
    return (
      <div className="kiosk-picker-preview kiosk-picker-preview-md" data-testid="kiosk-picker-preview">
        {content.title ?? content.content?.slice(0, 60)}
      </div>
    );
  }
  return null;
}

export function KioskPicker({
  kiosks,
  selectedKioskId,
  onSelect,
  displayContent,
}: KioskPickerProps) {
  // Stable presentation order: by display name. Picker UI feels janky
  // if the order changes on every device-list broadcast.
  const sorted = useMemo(
    () => [...kiosks].sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [kiosks],
  );

  return (
    <section
      className="kiosk-picker"
      role="radiogroup"
      aria-label="Pick the kiosk you want to drive"
      data-testid="kiosk-picker"
    >
      <header className="kiosk-picker-header">
        <h2>Pick a kiosk</h2>
        <p>Choose the screen you want to drive in this room.</p>
      </header>
      <DisplayPreview content={displayContent} />
      <ul className="kiosk-picker-list">
        {sorted.map((kiosk) => {
          const inSession = !!kiosk.activeSessionId;
          const isSelected = kiosk.id === selectedKioskId;
          return (
            <li key={kiosk.id}>
              <button
                type="button"
                role="radio"
                aria-checked={isSelected}
                className={`kiosk-picker-card${isSelected ? ' selected' : ''}`}
                onClick={() => onSelect(kiosk.id)}
                data-testid={`kiosk-picker-card-${kiosk.id}`}
              >
                <span className="kiosk-picker-card-name">🖥️ {kiosk.displayName}</span>
                <span className="kiosk-picker-card-meta">
                  {inSession ? (
                    <span
                      className="kiosk-picker-pill in-session"
                      data-testid={`kiosk-picker-pill-${kiosk.id}`}
                    >
                      🔴 In session
                    </span>
                  ) : (
                    <span className="kiosk-picker-pill idle">⚪ Idle</span>
                  )}
                  {kiosk.lastUsedAt ? (
                    <span className="kiosk-picker-last-used">
                      last used {relativeAgo(kiosk.lastUsedAt)}
                    </span>
                  ) : null}
                </span>
                {inSession ? (
                  <span className="kiosk-picker-action">Join in progress →</span>
                ) : (
                  <span className="kiosk-picker-action">Start here →</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
