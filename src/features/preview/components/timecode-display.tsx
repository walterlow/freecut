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
  const frameDigits = Math.max(totalFrames.toString().length, 1);
  const reservedCharWidth = Math.max(frameDigits, 11);
  const lastFrame = Math.max(0, totalFrames - 1);
  const reservedDisplayWidth = `calc(${reservedCharWidth * 2 + 1}ch + 1rem)`;

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

  return (
    <button
      type="button"
      className="inline-flex items-center gap-2 bg-transparent p-0 font-mono text-[13px] tabular-nums text-left transition-colors select-none text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-sm"
      style={{ width: reservedDisplayWidth }}
      onClick={() => setShowFrames((prev) => !prev)}
    >
      <span
        ref={currentTimeRef}
        className="text-primary font-semibold"
      >
        {showFrames ? formatFrameNumber(usePlaybackStore.getState().currentFrame) : formatTimecode(usePlaybackStore.getState().currentFrame, fps)}
      </span>
      <span className="text-muted-foreground/50">/</span>
      <span>
        {showFrames ? formatFrameNumber(lastFrame) : formatTimecode(lastFrame, fps)}
      </span>
    </button>
  );
}
