import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Separator } from '@/components/ui/separator';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  ChevronLeft,
  ChevronRight,
  Volume2,
} from 'lucide-react';
import { usePlaybackStore } from '@/features/preview/stores/playback-store';

interface PlaybackControlsProps {
  totalFrames: number;
}

/**
 * Playback Controls Component
 *
 * Transport controls with:
 * - Play/Pause toggle
 * - Frame navigation (previous/next)
 * - Skip to start/end
 * - Volume control
 */
export function PlaybackControls({ totalFrames }: PlaybackControlsProps) {
  // Use granular selectors - Zustand v5 best practice
  // NOTE: Don't subscribe to currentFrame - only needed in click handlers
  // Read from store directly when needed to avoid re-renders every frame
  const isPlaying = usePlaybackStore((s) => s.isPlaying);
  const volume = usePlaybackStore((s) => s.volume);
  const togglePlayPause = usePlaybackStore((s) => s.togglePlayPause);
  const setCurrentFrame = usePlaybackStore((s) => s.setCurrentFrame);
  const setVolume = usePlaybackStore((s) => s.setVolume);

  // Note: Automatic playback loop is now handled by Composition Player
  // The Player controls frame advancement via frameupdate events

  // Note: totalFrames is the count, so valid frame indices are [0, totalFrames - 1]
  const lastValidFrame = Math.max(0, totalFrames - 1);
  
  const handleGoToStart = () => setCurrentFrame(0);
  const handleGoToEnd = () => setCurrentFrame(lastValidFrame);
  const handlePreviousFrame = () => {
    const currentFrame = usePlaybackStore.getState().currentFrame;
    setCurrentFrame(Math.max(0, currentFrame - 1));
  };
  const handleNextFrame = () => {
    const currentFrame = usePlaybackStore.getState().currentFrame;
    setCurrentFrame(Math.min(lastValidFrame, currentFrame + 1));
  };

  return (
    <>
      {/* Transport Controls */}
      <div className="flex items-center gap-1 flex-shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9"
          onClick={handleGoToStart}
          data-tooltip="Go to Start (Home)"
          aria-label="Go to start"
        >
          <SkipBack className="w-4 h-4" />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9"
          onClick={handlePreviousFrame}
          data-tooltip="Previous Frame (Left Arrow)"
          aria-label="Previous frame"
        >
          <ChevronLeft className="w-4 h-4" />
        </Button>

        <Button
          size="icon"
          className="h-11 w-11 glow-primary-sm"
          onClick={togglePlayPause}
          data-tooltip={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
          aria-label={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? (
            <Pause className="w-5 h-5" />
          ) : (
            <Play className="w-5 h-5 ml-0.5" />
          )}
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9"
          onClick={handleNextFrame}
          data-tooltip="Next Frame (Right Arrow)"
          aria-label="Next frame"
        >
          <ChevronRight className="w-4 h-4" />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9"
          onClick={handleGoToEnd}
          data-tooltip="Go to End (End)"
          aria-label="Go to end"
        >
          <SkipForward className="w-4 h-4" />
        </Button>
      </div>

      <Separator orientation="vertical" className="h-8 flex-shrink-0" />

      {/* Volume Control — shrinks and clips when panel is narrow */}
      <div className="flex items-center gap-2 min-w-0 overflow-hidden flex-shrink">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 flex-shrink-0"
          data-tooltip="Volume"
          aria-label="Volume"
        >
          <Volume2 className="w-4 h-4" />
        </Button>
        <Slider
          value={[volume * 100]}
          onValueChange={(values) => setVolume((values[0] ?? 75) / 100)}
          onValueCommit={() => {
            if (document.activeElement instanceof HTMLElement) {
              document.activeElement.blur();
            }
          }}
          max={100}
          step={1}
          className="w-24 flex-shrink-0"
          aria-label="Volume control"
        />
        <span className="text-xs text-muted-foreground font-mono w-8 flex-shrink-0">
          {Math.round(volume * 100)}%
        </span>
      </div>
    </>
  );
}
