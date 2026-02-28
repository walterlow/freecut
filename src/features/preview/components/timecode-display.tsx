import { useState, useEffect, useRef, useCallback } from 'react';
import { usePlaybackStore } from '@/shared/state/playback';
import { formatTimecode } from '@/utils/time-utils';

interface TimecodeDisplayProps {
  fps: number;
  totalFrames: number;
}

/**
 * Timecode Display Component
 *
 * Displays current time and total duration in SMPTE format (HH:MM:SS:FF)
 * - Click to toggle between SMPTE timecode and frame numbers
 * - Synchronized with playback store via manual subscription (no re-renders during playback)
 * - Tabular numbers for consistent width
 * - Primary color for current time
 */
export function TimecodeDisplay({ fps, totalFrames }: TimecodeDisplayProps) {
  const [showFrames, setShowFrames] = useState(false);
  const currentTimeRef = useRef<HTMLSpanElement>(null);

  // Use refs for values accessed in subscription to avoid stale closures
  const showFramesRef = useRef(showFrames);
  showFramesRef.current = showFrames;
  const fpsRef = useRef(fps);
  fpsRef.current = fps;
  const totalFramesRef = useRef(totalFrames);
  totalFramesRef.current = totalFrames;

  // Format frame number with padding based on total frames to prevent layout shift
  const formatFrameNumber = useCallback((frame: number) => {
    const maxDigits = Math.max(totalFramesRef.current.toString().length, 1);
    return frame.toString().padStart(maxDigits, '0');
  }, []);

  // Subscribe to currentFrame changes and update DOM directly (no React re-renders)
  useEffect(() => {
    const updateDisplay = (frame: number) => {
      if (!currentTimeRef.current) return;
      currentTimeRef.current.textContent = showFramesRef.current
        ? formatFrameNumber(frame)
        : formatTimecode(frame, fpsRef.current);
    };

    // Initial update
    updateDisplay(usePlaybackStore.getState().currentFrame);

    // Subscribe to store changes
    return usePlaybackStore.subscribe((state) => {
      updateDisplay(state.currentFrame);
    });
  }, [formatFrameNumber]);

  // Update display when showFrames or fps changes (rare - can trigger re-render)
  useEffect(() => {
    if (!currentTimeRef.current) return;
    const frame = usePlaybackStore.getState().currentFrame;
    currentTimeRef.current.textContent = showFrames
      ? formatFrameNumber(frame)
      : formatTimecode(frame, fps);
  }, [showFrames, fps, formatFrameNumber]);

  // Fixed character width per display mode to prevent layout shift
  const charWidth = showFrames
    ? Math.max(totalFrames.toString().length, 1) // frame digits (zero-padded)
    : 11; // SMPTE "HH:MM:SS:FF" is always 11 chars

  return (
    <div
      className="px-4 py-2.5 bg-secondary/50 rounded-md border border-border cursor-pointer select-none hover:bg-secondary/70 transition-colors"
      onClick={() => setShowFrames((prev) => !prev)}
    >
      <div className="flex items-center gap-2 font-mono text-sm tabular-nums">
        <span
          ref={currentTimeRef}
          className="text-primary font-semibold inline-block text-right"
          style={{ width: `${charWidth}ch` }}
        >
          {showFrames ? formatFrameNumber(usePlaybackStore.getState().currentFrame) : formatTimecode(usePlaybackStore.getState().currentFrame, fps)}
        </span>
        <span className="text-muted-foreground/50">/</span>
        <span
          className="text-muted-foreground inline-block text-right"
          style={{ width: `${charWidth}ch` }}
        >
          {showFrames ? formatFrameNumber(Math.max(0, totalFrames - 1)) : formatTimecode(Math.max(0, totalFrames - 1), fps)}
        </span>
      </div>
    </div>
  );
}
