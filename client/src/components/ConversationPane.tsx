import { useRef, useEffect, useMemo } from 'react';
import type { Utterance } from '../types';

interface ConversationPaneProps {
  isOpen: boolean;
  onClose: () => void;
  utterances: Map<string, Utterance>;
  deviceId: string;
}

/**
 * Slide-in conversation pane showing message history.
 * Slides in from the right when opened.
 */
export function ConversationPane({
  isOpen,
  onClose,
  utterances,
  deviceId,
}: ConversationPaneProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Sort utterances by received time (memoized to avoid re-sorting on every render)
  // Note: Depend on utterances.size rather than the Map object to avoid
  // re-sorting on every render (Map reference changes even when content is the same)
  const sortedUtterances = useMemo(
    () => [...utterances.values()].sort(
      (a, b) => a.receivedAt.getTime() - b.receivedAt.getTime()
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [utterances.size]
  );

  // Auto-scroll to bottom when new messages arrive
  // Note: Depend on utterances.size rather than the Map object to avoid
  // excessive re-renders (Map reference changes on every render)
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [utterances.size, isOpen]);

  return (
    <>
      {/* Backdrop */}
      <div 
        className={`conversation-backdrop ${isOpen ? 'open' : ''}`}
        onClick={onClose}
      />
      
      {/* Slide-in panel */}
      <div className={`conversation-pane ${isOpen ? 'open' : ''}`}>
        <div className="conversation-header">
          <button className="conversation-back" onClick={onClose}>
            ← Back
          </button>
          <h3>Conversation</h3>
        </div>

        <div className="conversation-messages">
          {sortedUtterances.length === 0 ? (
            <div className="no-messages">
              No messages yet. Start the conversation!
            </div>
          ) : (
            sortedUtterances.map((utterance) => {
              const isOwnMessage = utterance.senderId === deviceId;
              return (
                <div 
                  key={utterance.id} 
                  className={`message ${utterance.partial ? 'partial' : 'final'} ${isOwnMessage ? 'own-message' : ''}`}
                >
                  <span className="sender">{isOwnMessage ? 'You' : utterance.senderName}:</span>
                  <span className="text">{utterance.text}</span>
                  {utterance.partial && <span className="typing-indicator">...</span>}
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>
    </>
  );
}
