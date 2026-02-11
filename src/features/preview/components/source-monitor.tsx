import { useState, useEffect, useRef, useCallback, memo } from 'react';
import { X, Play, Pause, SkipBack, SkipForward, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PlayerEmitterProvider } from '@/features/player/event-emitter';
import { ClockBridgeProvider, useBridgedTimelineContext } from '@/features/player/clock';
import { VideoConfigProvider } from '@/features/player/video-config-context';
import { usePlayer } from '@/features/player/use-player';
import { SourceComposition } from './source-composition';
import { resolveMediaUrl } from '../utils/media-resolver';
import { useMediaLibraryStore } from '@/features/media-library/stores/media-library-store';
import { getMediaType } from '@/features/media-library/utils/validation';
import { useSourcePlayerStore } from '../stores/source-player-store';

interface SourceMonitorProps {
  mediaId: string;
  onClose: () => void;
}

export const SourceMonitor = memo(function SourceMonitor({ mediaId, onClose }: SourceMonitorProps) {
  const [blobUrl, setBlobUrl] = useState<string>('');
  const media = useMediaLibraryStore((s) => s.mediaItems.find((m) => m.id === mediaId));

  // Auto-close if media is deleted
  useEffect(() => {
    if (!media) {
      onClose();
    }
  }, [media, onClose]);

  // Resolve blob URL
  useEffect(() => {
    let cancelled = false;
    resolveMediaUrl(mediaId).then((url) => {
      if (!cancelled) setBlobUrl(url);
    });
    return () => { cancelled = true; };
  }, [mediaId]);

  if (!media) return null;

  const mediaType = getMediaType(media.mimeType);
  if (mediaType === 'unknown') return null;

  const fps = media.fps || 30;
  const mediaWidth = media.width || 640;
  const mediaHeight = media.height || 360;
  const durationInFrames = mediaType === 'image'
    ? 1
    : Math.max(1, Math.round(media.duration * fps));

  return (
    <PlayerEmitterProvider>
      <ClockBridgeProvider
        fps={fps}
        durationInFrames={durationInFrames}
        onVolumeChange={() => {}}
      >
        <VideoConfigProvider
          fps={fps}
          width={mediaWidth}
          height={mediaHeight}
          durationInFrames={durationInFrames}
        >
          <SourceMonitorInner
            src={blobUrl}
            mediaType={mediaType}
            fileName={media.fileName}
            mediaWidth={mediaWidth}
            mediaHeight={mediaHeight}
            durationInFrames={durationInFrames}
            fps={fps}
            onClose={onClose}
          />
        </VideoConfigProvider>
      </ClockBridgeProvider>
    </PlayerEmitterProvider>
  );
});

// -- Inner component (rendered inside provider tree) --

interface SourceMonitorInnerProps {
  src: string;
  mediaType: 'video' | 'audio' | 'image';
  fileName: string;
  mediaWidth: number;
  mediaHeight: number;
  durationInFrames: number;
  fps: number;
  onClose: () => void;
}

function SourceMonitorInner({
  src,
  mediaType,
  fileName,
  mediaWidth,
  mediaHeight,
  durationInFrames,
  fps,
  onClose,
}: SourceMonitorInnerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentHostRef = useRef<HTMLDivElement>(null);
  const contentScaleRef = useRef<HTMLDivElement>(null);

  // Scale composition to fit container - subtract same padding as program monitor
  const PADDING_PX = 48;
  const updateLayout = useCallback(() => {
    const container = containerRef.current;
    const host = contentHostRef.current;
    const scaleDiv = contentScaleRef.current;
    if (!container || !host || !scaleDiv) return;

    const cw = Math.max(0, container.clientWidth - PADDING_PX);
    const ch = Math.max(0, container.clientHeight - PADDING_PX);
    const scale = cw > 0 && ch > 0
      ? Math.min(cw / mediaWidth, ch / mediaHeight)
      : 1;

    const sw = mediaWidth * scale;
    const sh = mediaHeight * scale;

    host.style.width = `${sw}px`;
    host.style.height = `${sh}px`;
    host.style.marginLeft = `${-sw / 2}px`;
    host.style.marginTop = `${-sh / 2}px`;

    scaleDiv.style.width = `${mediaWidth}px`;
    scaleDiv.style.height = `${mediaHeight}px`;
    scaleDiv.style.transform = `scale(${scale})`;
  }, [mediaWidth, mediaHeight]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let rafId: number | null = null;
    const schedule = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        updateLayout();
      });
    };
    const obs = new ResizeObserver(schedule);
    obs.observe(el);
    updateLayout();
    return () => {
      obs.disconnect();
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [updateLayout]);

  // When media URL resolves, the preview host nodes mount after the initial
  // layout pass. Force one more measurement so the source appears immediately.
  useEffect(() => {
    if (!src) return;
    const rafId = requestAnimationFrame(() => {
      updateLayout();
    });
    return () => {
      cancelAnimationFrame(rafId);
    };
  }, [src, updateLayout]);

  const setHoveredPanel = useSourcePlayerStore((s) => s.setHoveredPanel);
  const setPlayerMethods = useSourcePlayerStore((s) => s.setPlayerMethods);

  // Reset hover and player methods on unmount
  useEffect(() => {
    return () => {
      setHoveredPanel(null);
      setPlayerMethods(null);
    };
  }, [setHoveredPanel, setPlayerMethods]);

  return (
    <div
      className="flex-1 flex flex-col min-w-0"
      onMouseEnter={() => setHoveredPanel('source')}
      onMouseLeave={() => setHoveredPanel(null)}
    >
      {/* Header */}
      <div className="h-9 border-b border-border flex items-center px-3 justify-between flex-shrink-0">
        <span className="text-xs text-muted-foreground truncate">
          Source: {fileName}
        </span>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-muted transition-colors flex-shrink-0"
          aria-label="Close source monitor"
        >
          <X className="w-3.5 h-3.5 text-muted-foreground" />
        </button>
      </div>

      {/* Video area - same gradient bg as composition panel */}
      <div
        ref={containerRef}
        className="flex-1 min-h-0 relative overflow-hidden bg-gradient-to-br from-background to-secondary/20"
      >
        {src ? (
          <div
            ref={contentHostRef}
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              overflow: 'hidden',
            }}
          >
            <div
              ref={contentScaleRef}
              style={{ transformOrigin: 'top left' }}
            >
              <SourceComposition
                src={src}
                mediaType={mediaType}
                fileName={fileName}
              />
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            Loading media...
          </div>
        )}
      </div>

      {/* Controls bar - same h-16 as program monitor */}
      <SourcePlaybackControls durationInFrames={durationInFrames} fps={fps} />
    </div>
  );
}

// -- Playback controls for the source monitor --

function SourcePlaybackControls({
  durationInFrames,
  fps,
}: {
  durationInFrames: number;
  fps: number;
}) {
  const player = usePlayer(durationInFrames);
  const { frame, playing } = useBridgedTimelineContext();
  const lastFrame = Math.max(0, durationInFrames - 1);

  // Bridge player methods into the source player store for keyboard shortcuts
  useEffect(() => {
    const setPlayerMethods = useSourcePlayerStore.getState().setPlayerMethods;
    setPlayerMethods({
      toggle: player.toggle,
      seek: player.seek,
      frameBack: player.frameBack,
      frameForward: player.frameForward,
      getDurationInFrames: () => durationInFrames,
    });
    return () => {
      useSourcePlayerStore.getState().setPlayerMethods(null);
    };
  }, [player.toggle, player.seek, player.frameBack, player.frameForward, durationInFrames]);

  const formatTime = (f: number) => {
    const secs = f / fps;
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  // Progress bar with drag support
  const barRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const onMoveRef = useRef<((ev: MouseEvent) => void) | null>(null);
  const onUpRef = useRef<(() => void) | null>(null);

  const seekFromX = useCallback(
    (clientX: number) => {
      const bar = barRef.current;
      if (!bar) return;
      const rect = bar.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      player.seek(Math.round(pct * lastFrame));
    },
    [player, lastFrame],
  );

  const handleBarMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      draggingRef.current = true;
      seekFromX(e.clientX);
      const onMove = (ev: MouseEvent) => {
        if (draggingRef.current) seekFromX(ev.clientX);
      };
      const onUp = () => {
        draggingRef.current = false;
        if (onMoveRef.current) {
          document.removeEventListener('mousemove', onMoveRef.current);
          onMoveRef.current = null;
        }
        if (onUpRef.current) {
          document.removeEventListener('mouseup', onUpRef.current);
          onUpRef.current = null;
        }
      };
      onMoveRef.current = onMove;
      onUpRef.current = onUp;
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [seekFromX],
  );

  // Clean up document listeners on unmount
  useEffect(() => {
    return () => {
      if (onMoveRef.current) {
        document.removeEventListener('mousemove', onMoveRef.current);
        onMoveRef.current = null;
      }
      if (onUpRef.current) {
        document.removeEventListener('mouseup', onUpRef.current);
        onUpRef.current = null;
      }
      draggingRef.current = false;
    };
  }, []);

  const progress = lastFrame > 0 ? (frame / lastFrame) * 100 : 0;

  return (
    <div className="h-16 border-t border-border panel-header flex flex-col justify-center px-4 flex-shrink-0 gap-1.5">
      {/* Progress bar */}
      <div
        ref={barRef}
        className="w-full h-1.5 bg-muted rounded cursor-pointer overflow-hidden"
        onMouseDown={handleBarMouseDown}
      >
        <div
          className="h-full bg-primary transition-none pointer-events-none"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Transport row */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-mono text-muted-foreground">
          {formatTime(frame)} / {formatTime(lastFrame)}
        </span>

        <div className="flex items-center gap-0.5">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => player.seek(0)}>
            <SkipBack className="w-3.5 h-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => player.frameBack(1)}>
            <ChevronLeft className="w-3.5 h-3.5" />
          </Button>
          <Button size="icon" className="h-8 w-8" onClick={() => player.toggle()}>
            {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => player.frameForward(1)}>
            <ChevronRight className="w-3.5 h-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => player.seek(lastFrame)}>
            <SkipForward className="w-3.5 h-3.5" />
          </Button>
        </div>

        <div className="w-20" />
      </div>
    </div>
  );
}
