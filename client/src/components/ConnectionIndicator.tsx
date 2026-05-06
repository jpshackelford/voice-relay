interface ConnectionIndicatorProps {
  connected: boolean;
}

/**
 * A small plug icon in the lower-right corner that shows connection status.
 * Always visible regardless of sidebar state.
 */
export function ConnectionIndicator({ connected }: ConnectionIndicatorProps) {
  return (
    <div 
      className={`connection-indicator ${connected ? 'connected' : 'disconnected'}`}
      title={connected ? 'Connected' : 'Disconnected'}
    >
      {/* Plug icon using Unicode character */}
      <span className="plug-icon">🔌</span>
    </div>
  );
}
