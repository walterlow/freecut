import { useState } from 'react';
import { usePlaybackStore } from '@/features/preview/stores/playback-store';
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
 * - Synchronized with playback store
 * - Tabular numbers for consistent width
 * - Primary color for current time
 */
export function TimecodeDisplay({ fps, totalFrames }: TimecodeDisplayProps) {
  const currentFrame = usePlaybackStore((s) => s.currentFrame);
  const [showFrames, setShowFrames] = useState(false);

  // Format frame number with padding based on total frames to prevent layout shift
  const formatFrameNumber = (frame: number) => {
    const maxDigits = Math.max(totalFrames.toString().length, 1);
    return frame.toString().padStart(maxDigits, '0');
  };

  return (
    <div
      className="px-4 py-2.5 bg-secondary/50 rounded-md border border-border cursor-pointer select-none hover:bg-secondary/70 transition-colors"
      onClick={() => setShowFrames((prev) => !prev)}
    >
      <div className="flex items-center gap-2 font-mono text-sm tabular-nums">
        <span className="text-primary font-semibold">
          {showFrames ? formatFrameNumber(currentFrame) : formatTimecode(currentFrame, fps)}
        </span>
        <span className="text-muted-foreground/50">/</span>
        <span className="text-muted-foreground">
          {showFrames ? formatFrameNumber(totalFrames) : formatTimecode(totalFrames, fps)}
        </span>
      </div>
    </div>
  );
}
