import { useState } from 'react';
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
  Zap,
  Camera,
  Loader2,
} from 'lucide-react';
import { usePlaybackStore } from '@/shared/state/playback';
import { EDITOR_LAYOUT_CSS_VALUES } from '@/shared/ui/editor-layout';
import { useMediaLibraryStore, mediaLibraryService } from '@/features/preview/deps/media-library-contract';
import { formatTimecode } from '@/utils/time-utils';
import { toast } from 'sonner';

interface PlaybackControlsProps {
  totalFrames: number;
  fps: number;
}

const PREVIEW_CONTROL_BUTTON_STYLE = {
  height: EDITOR_LAYOUT_CSS_VALUES.previewControlButtonSize,
  width: EDITOR_LAYOUT_CSS_VALUES.previewControlButtonSize,
};

async function canvasToBlob(
  canvas: OffscreenCanvas | HTMLCanvasElement,
  type: string
): Promise<Blob> {
  if ('convertToBlob' in canvas) {
    return canvas.convertToBlob({ type });
  }

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
        return;
      }
      reject(new Error('Failed to convert frame to blob'));
    }, type);
  });
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const response = await fetch(dataUrl);
  return response.blob();
}

function scheduleBlobUrlRevoke(url: string): void {
  if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
    window.requestIdleCallback(() => URL.revokeObjectURL(url));
    return;
  }

  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  scheduleBlobUrlRevoke(url);
}

function buildFrameFileName(frame: number, fps: number, totalFrames: number): string {
  const safeFrame = Math.max(0, Math.round(frame));
  const safeFps = Number.isFinite(fps) && fps > 0 ? fps : 30;
  const frameDigits = Math.max(String(Math.max(0, totalFrames - 1)).length, 1);
  const paddedFrame = String(safeFrame).padStart(frameDigits, '0');
  const safeTimecode = formatTimecode(safeFrame, safeFps).replaceAll(':', '-');
  return `frame-${paddedFrame}-${safeTimecode}.png`;
}

/**
 * Playback Controls Component
 *
 * Transport controls with:
 * - Play/Pause toggle
 * - Frame navigation (previous/next)
 * - Skip to start/end
 * - Frame capture
 * - Volume control
 */
export function PlaybackControls({ totalFrames, fps }: PlaybackControlsProps) {
  const [isSavingFrame, setIsSavingFrame] = useState(false);

  // Use granular selectors - Zustand v5 best practice
  // NOTE: Don't subscribe to currentFrame - only needed in click handlers
  // Read from store directly when needed to avoid re-renders every frame
  const isPlaying = usePlaybackStore((s) => s.isPlaying);
  const volume = usePlaybackStore((s) => s.volume);
  const useProxy = usePlaybackStore((s) => s.useProxy);
  const togglePlayPause = usePlaybackStore((s) => s.togglePlayPause);
  const setCurrentFrame = usePlaybackStore((s) => s.setCurrentFrame);
  const setPreviewFrame = usePlaybackStore((s) => s.setPreviewFrame);
  const setDisplayedFrame = usePlaybackStore((s) => s.setDisplayedFrame);
  const setVolume = usePlaybackStore((s) => s.setVolume);
  const toggleUseProxy = usePlaybackStore((s) => s.toggleUseProxy);

  // Note: Automatic playback loop is now handled by Composition Player
  // The Player controls frame advancement via frameupdate events

  // Note: totalFrames is the count, so valid frame indices are [0, totalFrames - 1]
  const lastValidFrame = Math.max(0, totalFrames - 1);

  const commitTimelineSeek = (frame: number) => {
    // Transport seeks should exit hover-scrub state so Player rendering
    // follows the actual playhead immediately.
    setPreviewFrame(null);
    setDisplayedFrame(null);
    setCurrentFrame(frame);
  };

  const handleGoToStart = () => commitTimelineSeek(0);
  const handleGoToEnd = () => commitTimelineSeek(lastValidFrame);
  const handlePreviousFrame = () => {
    const currentFrame = usePlaybackStore.getState().currentFrame;
    commitTimelineSeek(Math.max(0, currentFrame - 1));
  };
  const handleNextFrame = () => {
    const currentFrame = usePlaybackStore.getState().currentFrame;
    commitTimelineSeek(Math.min(lastValidFrame, currentFrame + 1));
  };

  const handleSaveFrame = async () => {
    if (isSavingFrame) return;

    setIsSavingFrame(true);

    try {
      const playback = usePlaybackStore.getState();
      const currentFrame = playback.previewFrame ?? playback.currentFrame;
      const fileName = buildFrameFileName(currentFrame, fps, totalFrames);

      let frameBlob: Blob | null = null;
      let frameWidth: number | undefined;
      let frameHeight: number | undefined;

      if (playback.captureCanvasSource) {
        const canvasSource = await playback.captureCanvasSource();
        if (canvasSource) {
          frameBlob = await canvasToBlob(canvasSource, 'image/png');
          frameWidth = canvasSource.width;
          frameHeight = canvasSource.height;
        }
      }

      if (!frameBlob && playback.captureFrame) {
        const dataUrl = await playback.captureFrame({
          format: 'image/png',
          quality: 1,
          fullResolution: true,
        });

        if (dataUrl) {
          frameBlob = await dataUrlToBlob(dataUrl);
        }
      }

      if (!frameBlob) {
        toast.error('Failed to capture the current frame.');
        return;
      }

      downloadBlob(frameBlob, fileName);

      const currentProjectId = useMediaLibraryStore.getState().currentProjectId;
      if (!currentProjectId) {
        toast.error('Downloaded the frame, but no project is selected for media library import.');
        return;
      }

      const frameFile = new File([frameBlob], fileName, {
        type: 'image/png',
        lastModified: Date.now(),
      });

      const savedMedia = await mediaLibraryService.importGeneratedImage(frameFile, currentProjectId, {
        width: frameWidth,
        height: frameHeight,
        tags: ['frame-capture'],
        codec: 'png',
      });

      useMediaLibraryStore.setState((state) => ({
        mediaItems: [savedMedia, ...state.mediaItems],
      }));

      toast.success(`Saved "${savedMedia.fileName}" to the media library and started the download.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save frame.';
      toast.error(`Downloaded frame, but could not save it to the media library. ${message}`);
    } finally {
      setIsSavingFrame(false);
    }
  };

  return (
    <>
      {/* Transport Controls */}
      <div className="flex items-center gap-1 flex-shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="flex-shrink-0"
          style={PREVIEW_CONTROL_BUTTON_STYLE}
          onClick={handleGoToStart}
          data-tooltip="Go to Start (Home)"
          aria-label="Go to start"
        >
          <SkipBack className="w-4 h-4" />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className="flex-shrink-0"
          style={PREVIEW_CONTROL_BUTTON_STYLE}
          onClick={handlePreviousFrame}
          data-tooltip="Previous Frame (Left Arrow)"
          aria-label="Previous frame"
        >
          <ChevronLeft className="w-4 h-4" />
        </Button>

        <Button
          size="icon"
          className="glow-primary-sm flex-shrink-0"
          style={PREVIEW_CONTROL_BUTTON_STYLE}
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
          className="flex-shrink-0"
          style={PREVIEW_CONTROL_BUTTON_STYLE}
          onClick={handleNextFrame}
          data-tooltip="Next Frame (Right Arrow)"
          aria-label="Next frame"
        >
          <ChevronRight className="w-4 h-4" />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className="flex-shrink-0"
          style={PREVIEW_CONTROL_BUTTON_STYLE}
          onClick={handleGoToEnd}
          data-tooltip="Go to End (End)"
          aria-label="Go to end"
        >
          <SkipForward className="w-4 h-4" />
        </Button>
      </div>

      <Separator orientation="vertical" className="h-6 flex-shrink-0" />

      <Button
        variant="ghost"
        size="icon"
        className="flex-shrink-0"
        style={PREVIEW_CONTROL_BUTTON_STYLE}
        onClick={() => {
          void handleSaveFrame();
        }}
        disabled={isSavingFrame}
        data-tooltip={isSavingFrame ? 'Saving Frame...' : 'Save Frame'}
        aria-label={isSavingFrame ? 'Saving frame' : 'Save frame'}
      >
        {isSavingFrame ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Camera className="w-4 h-4" />
        )}
      </Button>

      <Separator orientation="vertical" className="h-6 flex-shrink-0" />

      {/* Volume Control - shrinks and clips when panel is narrow */}
      <div className="flex items-center gap-2 min-w-0 overflow-hidden flex-shrink">
        <Button
          variant="ghost"
          size="icon"
          className="flex-shrink-0"
          style={PREVIEW_CONTROL_BUTTON_STYLE}
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
          className="w-20 flex-shrink-0"
          aria-label="Volume control"
        />
        <span className="text-[11px] text-muted-foreground font-mono w-7 flex-shrink-0">
          {Math.round(volume * 100)}%
        </span>
      </div>

      <Separator orientation="vertical" className="h-6 flex-shrink-0" />

      <Button
        variant="ghost"
        size="icon"
        className={`flex-shrink-0 ${
          useProxy
            ? 'text-green-500 hover:text-green-400 hover:bg-green-500/10'
            : 'text-muted-foreground hover:text-foreground'
        }`}
        style={PREVIEW_CONTROL_BUTTON_STYLE}
        onClick={toggleUseProxy}
        data-tooltip={useProxy ? 'Proxy Playback: On' : 'Proxy Playback: Off'}
        aria-label={useProxy ? 'Disable proxy playback' : 'Enable proxy playback'}
      >
        <Zap className="w-4 h-4" />
      </Button>
    </>
  );
}
