/**
 * Audio playback hook for server-side TTS audio streaming.
 * 
 * Buffers MP3 audio chunks received from the server and plays them
 * sequentially using HTMLAudioElement for broad browser compatibility.
 */

import { useCallback, useRef, useState, useEffect } from 'react';
import type { AudioChunkMessage, AudioEndMessage } from '../types';

/** Timeout for cleaning up stale audio chunks if audio-end never arrives */
const CHUNK_TIMEOUT_MS = 30000;

interface UseAudioPlaybackReturn {
  /** Whether audio is currently playing */
  isPlaying: boolean;
  /** Current utterance being played */
  currentUtteranceId: string | null;
  /** Handle incoming audio chunk from server */
  handleAudioChunk: (message: AudioChunkMessage) => void;
  /** Handle audio end signal from server */
  handleAudioEnd: (message: AudioEndMessage) => void;
  /** Stop all audio playback */
  stop: () => void;
}

interface AudioQueueItem {
  utteranceId: string;
  audioData: ArrayBuffer;
}

/**
 * Hook for managing server-side TTS audio playback on kiosk devices.
 * 
 * Audio is streamed as base64-encoded MP3 chunks. This hook:
 * 1. Decodes incoming chunks to ArrayBuffer
 * 2. Queues chunks for sequential playback
 * 3. Uses HTMLAudioElement for broad browser compatibility
 * 4. Cleans up stale chunks after timeout to prevent memory leaks
 */
export function useAudioPlayback(): UseAudioPlaybackReturn {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentUtteranceId, setCurrentUtteranceId] = useState<string | null>(null);
  
  // Audio queue for buffering chunks
  const queueRef = useRef<AudioQueueItem[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const currentBlobUrlRef = useRef<string | null>(null);
  
  // Buffer for accumulating chunks for the same utterance
  const chunkBufferRef = useRef<Map<string, Uint8Array[]>>(new Map());
  
  // Timeouts for cleaning up stale chunks (prevents memory leak if audio-end never arrives)
  const chunkTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (currentBlobUrlRef.current) {
        URL.revokeObjectURL(currentBlobUrlRef.current);
      }
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      // Clear all chunk timeouts
      for (const timeout of chunkTimeoutsRef.current.values()) {
        clearTimeout(timeout);
      }
      chunkTimeoutsRef.current.clear();
    };
  }, []);

  const playNextChunk = useCallback(() => {
    const item = queueRef.current.shift();
    if (!item) {
      setIsPlaying(false);
      setCurrentUtteranceId(null);
      return;
    }

    setIsPlaying(true);
    setCurrentUtteranceId(item.utteranceId);

    // Clean up previous blob URL
    if (currentBlobUrlRef.current) {
      URL.revokeObjectURL(currentBlobUrlRef.current);
      currentBlobUrlRef.current = null;
    }

    // Create blob URL for this audio chunk
    const blob = new Blob([item.audioData], { type: 'audio/mpeg' });
    const url = URL.createObjectURL(blob);
    currentBlobUrlRef.current = url;

    // Create audio element and play
    const audio = new Audio(url);
    audioRef.current = audio;

    audio.onended = () => {
      playNextChunk();
    };

    audio.onerror = (e) => {
      console.error('[AudioPlayback] Error playing audio:', e);
      playNextChunk();
    };

    audio.play().catch((err) => {
      console.error('[AudioPlayback] Failed to play audio:', err);
      playNextChunk();
    });
  }, []);

  const handleAudioChunk = useCallback((message: AudioChunkMessage) => {
    const { utteranceId, audio } = message;

    try {
      // Decode base64 to ArrayBuffer
      const binaryString = atob(audio);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Reset timeout for this utterance (cleanup if audio-end never arrives)
      const existingTimeout = chunkTimeoutsRef.current.get(utteranceId);
      if (existingTimeout) {
        clearTimeout(existingTimeout);
      }
      const timeout = setTimeout(() => {
        console.warn('[AudioPlayback] Timeout waiting for audio-end:', utteranceId);
        chunkBufferRef.current.delete(utteranceId);
        chunkTimeoutsRef.current.delete(utteranceId);
      }, CHUNK_TIMEOUT_MS);
      chunkTimeoutsRef.current.set(utteranceId, timeout);

      // Accumulate chunks for this utterance
      let chunks = chunkBufferRef.current.get(utteranceId);
      if (!chunks) {
        chunks = [];
        chunkBufferRef.current.set(utteranceId, chunks);
      }
      chunks.push(bytes);
    } catch (err) {
      console.error('[AudioPlayback] Failed to decode audio chunk:', err);
    }
  }, []);

  const handleAudioEnd = useCallback((message: AudioEndMessage) => {
    const { utteranceId, error } = message;

    // Clear timeout for this utterance
    const timeout = chunkTimeoutsRef.current.get(utteranceId);
    if (timeout) {
      clearTimeout(timeout);
      chunkTimeoutsRef.current.delete(utteranceId);
    }

    if (error) {
      console.error('[AudioPlayback] TTS error for utterance', utteranceId, ':', error);
      // Clean up buffered chunks for failed utterance
      chunkBufferRef.current.delete(utteranceId);
      return;
    }

    // Get all accumulated chunks for this utterance
    const chunks = chunkBufferRef.current.get(utteranceId);
    chunkBufferRef.current.delete(utteranceId);

    if (!chunks || chunks.length === 0) {
      console.warn('[AudioPlayback] No chunks for completed utterance:', utteranceId);
      return;
    }

    // Combine all chunks into single ArrayBuffer
    const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }

    // Queue the complete audio for playback
    queueRef.current.push({
      utteranceId,
      audioData: combined.buffer,
    });

    // Start playback if not already playing
    if (!isPlaying && queueRef.current.length === 1) {
      playNextChunk();
    }
  }, [isPlaying, playNextChunk]);

  const stop = useCallback(() => {
    // Stop current playback
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    // Clear queue and buffers
    queueRef.current = [];
    chunkBufferRef.current.clear();

    // Clear all chunk timeouts
    for (const timeout of chunkTimeoutsRef.current.values()) {
      clearTimeout(timeout);
    }
    chunkTimeoutsRef.current.clear();

    // Clean up blob URL
    if (currentBlobUrlRef.current) {
      URL.revokeObjectURL(currentBlobUrlRef.current);
      currentBlobUrlRef.current = null;
    }

    setIsPlaying(false);
    setCurrentUtteranceId(null);
  }, []);

  return {
    isPlaying,
    currentUtteranceId,
    handleAudioChunk,
    handleAudioEnd,
    stop,
  };
}
