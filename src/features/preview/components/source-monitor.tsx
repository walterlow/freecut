import { useState, useEffect, useRef, useCallback, memo } from 'react';
import { X, Play, Pause, SkipBack, SkipForward, ChevronLeft, ChevronRight, Repeat, ArrowLeftToLine, ArrowRightToLine, XCircle, ArrowDownToLine, Replace } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { performInsertEdit, performOverwriteEdit } from '@/features/timeline/stores/actions/source-edit-actions';
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

  // Sync current media ID into source player store for I/O points
  useEffect(() => {
    useSourcePlayerStore.getState().setCurrentMediaId(mediaId);
    return () => {
      useSourcePlayerStore.getState().setCurrentMediaId(null);
    };
  }, [mediaId]);

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
    }).catch(() => {
      // Resolution failure already logged in resolveMediaUrl
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

  // Handle I/O shortcuts locally on this element (not global useHotkeys)
  const wrapperRef = useRef<HTMLDivElement>(null);
  const hadFocusRef = useRef(false);
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    const { currentSourceFrame, setInPoint, setOutPoint, clearInOutPoints } = useSourcePlayerStore.getState();
    if (e.key === 'i' || e.key === 'I') {
      e.preventDefault();
      e.stopPropagation();
      setInPoint(currentSourceFrame);
    } else if (e.key === 'o' || e.key === 'O') {
      e.preventDefault();
      e.stopPropagation();
      setOutPoint(currentSourceFrame);
    } else if (e.altKey && (e.key === 'x' || e.key === 'X')) {
      e.preventDefault();
      e.stopPropagation();
      clearInOutPoints();
    }
  }, []);

  const handleMouseEnter = useCallback(() => {
    setHoveredPanel('source');
    // Only grab focus if nothing meaningful is focused (avoid stealing from inputs)
    const active = document.activeElement;
    if (active === document.body || wrapperRef.current?.contains(active)) {
      wrapperRef.current?.focus();
      hadFocusRef.current = true;
    }
  }, [setHoveredPanel]);

  const handleMouseLeave = useCallback(() => {
    setHoveredPanel(null);
    if (hadFocusRef.current) {
      wrapperRef.current?.blur();
      hadFocusRef.current = false;
    }
  }, [setHoveredPanel]);

  return (
    <div
      ref={wrapperRef}
      tabIndex={-1}
      className="flex-1 flex flex-col min-w-0 outline-none"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onKeyDown={handleKeyDown}
    >
      {/* Header */}
      <div className="h-9 border-b border-border flex items-center px-3 justify-between shrink-0">
        <span className="text-xs text-muted-foreground truncate">
          Source: {fileName}
        </span>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-muted transition-colors shrink-0"
          aria-label="Close source monitor"
        >
          <X className="w-3.5 h-3.5 text-muted-foreground" />
        </button>
      </div>

      {/* Video area - same gradient bg as composition panel */}
      <div
        ref={containerRef}
        className="flex-1 min-h-0 relative overflow-hidden bg-video-preview-background"
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

  // Sync current frame into source player store for Mark I/O
  useEffect(() => {
    useSourcePlayerStore.getState().setCurrentSourceFrame(frame);
  }, [frame]);

  // Consume pending seek (e.g. double-click opens clip at its In point)
  const pendingSeekFrame = useSourcePlayerStore((s) => s.pendingSeekFrame);
  useEffect(() => {
    if (pendingSeekFrame !== null) {
      player.seek(pendingSeekFrame);
      useSourcePlayerStore.getState().setPendingSeekFrame(null);
    }
  }, [pendingSeekFrame, player]);

  // Read I/O points from store
  const inPoint = useSourcePlayerStore((s) => s.inPoint);
  const outPoint = useSourcePlayerStore((s) => s.outPoint);

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

  // I/O marker positions as percentages
  const inPct = inPoint !== null && lastFrame > 0 ? (inPoint / lastFrame) * 100 : null;
  const outPct = outPoint !== null && lastFrame > 0 ? (outPoint / lastFrame) * 100 : null;

  // Duration display when both I/O are set
  const ioDuration = inPoint !== null && outPoint !== null
    ? formatTime(outPoint - inPoint)
    : null;

  const handleMarkIn = useCallback(() => {
    useSourcePlayerStore.getState().setInPoint(frame);
  }, [frame]);

  const handleMarkOut = useCallback(() => {
    useSourcePlayerStore.getState().setOutPoint(frame);
  }, [frame]);

  const handleClearIO = useCallback(() => {
    useSourcePlayerStore.getState().clearInOutPoints();
  }, []);

  // Auto-stop playback at out point
  const replayingRef = useRef(false);

  useEffect(() => {
    if (!replayingRef.current || !playing) {
      if (!playing) replayingRef.current = false;
      return;
    }
    if (outPoint !== null && frame >= outPoint) {
      player.pause();
      replayingRef.current = false;
    }
  }, [frame, playing, outPoint, player]);

  const handleReplaySegment = useCallback(() => {
    const { inPoint: ip, outPoint: op } = useSourcePlayerStore.getState();
    if (ip === null && op === null) return;
    replayingRef.current = true;
    player.seek(ip ?? 0);
    player.play();
  }, [player]);

  return (
    <div className="h-16 border-t border-border panel-header flex flex-col justify-center px-4 shrink-0 gap-1.5">
      {/* Progress bar with I/O markers drawn on top */}
      <div
        ref={barRef}
        className="w-full h-1.5 bg-muted rounded cursor-pointer relative"
        onMouseDown={handleBarMouseDown}
      >
        {/* Playhead progress (bottom layer) */}
        <div
          className="absolute inset-y-0 left-0 bg-primary transition-none pointer-events-none rounded-l"
          style={{ width: `${progress}%` }}
        />
        {/* Shaded region between in/out points */}
        {inPct !== null && outPct !== null && (
          <div
            className="absolute inset-y-0 bg-blue-400/50 pointer-events-none z-10"
            style={{ left: `${inPct}%`, width: `${outPct - inPct}%` }}
          />
        )}
        {/* In marker */}
        {inPct !== null && (
          <div
            className="absolute inset-y-0 w-0.5 bg-blue-400 pointer-events-none z-20"
            style={{ left: `${inPct}%` }}
          />
        )}
        {/* Out marker */}
        {outPct !== null && (
          <div
            className="absolute inset-y-0 w-0.5 bg-orange-400 pointer-events-none z-20"
            style={{ left: `${outPct}%` }}
          />
        )}
      </div>

      {/* Transport row */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-mono text-muted-foreground w-[11ch] shrink-0">
          {formatTime(frame)} / {formatTime(lastFrame)}
        </span>
        <span className="text-xs font-mono text-primary/70 w-[7ch] shrink-0">
          {ioDuration ? `[${ioDuration}]` : ''}
        </span>

        <div className="flex items-center gap-0.5 shrink-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => player.seek(0)}>
                <SkipBack className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Go to start (Home)</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => player.frameBack(1)}>
                <ChevronLeft className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Previous frame (←)</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon" className="h-8 w-8" onClick={() => player.toggle()}>
                {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">{playing ? 'Pause' : 'Play'} (Space)</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => player.frameForward(1)}>
                <ChevronRight className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Next frame (→)</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => player.seek(lastFrame)}>
                <SkipForward className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Go to end (End)</TooltipContent>
          </Tooltip>
        </div>

        {/* Source editing buttons */}
        <div className="flex items-center gap-0.5 shrink-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                disabled={inPoint === null && outPoint === null}
                onClick={handleReplaySegment}
              >
                <Repeat className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Play In to Out</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleMarkIn}>
                <ArrowLeftToLine className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Mark In (I)</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleMarkOut}>
                <ArrowRightToLine className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Mark Out (O)</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleClearIO}>
                <XCircle className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Clear In/Out (Alt+X)</TooltipContent>
          </Tooltip>
          <div className="w-px h-4 bg-border mx-0.5" />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => performInsertEdit()}>
                <ArrowDownToLine className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Insert (,)</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => performOverwriteEdit()}>
                <Replace className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Overwrite (.)</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}
