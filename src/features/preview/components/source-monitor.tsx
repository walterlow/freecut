import { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react';
import { X, Play, Pause, SkipBack, SkipForward, ChevronLeft, ChevronRight, ChevronDown, Repeat, ArrowLeftToLine, ArrowRightToLine, XCircle, ArrowDownToLine, Replace } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import {
  getTrackKind,
  performInsertEdit,
  performOverwriteEdit,
  resolveSourceEditTrackTargets,
} from '@/features/preview/deps/timeline-source-edit';
import {
  PlayerEmitterProvider,
  ClockBridgeProvider,
  useClock,
  useClockIsPlaying,
  VideoConfigProvider,
  usePlayer,
} from '@/features/preview/deps/player-context';
import { SourceComposition } from './source-composition';
import { resolveMediaUrl } from '../utils/media-resolver';
import {
  clampDraggedSourceInPoint,
  clampDraggedSourceOutPoint,
  getExclusiveSourceOutPoint,
  getSourcePointPercent,
  getSourceStripPointFromRatio,
  shiftSourceIoRange,
} from '../utils/source-io';
import { useMediaLibraryStore, getMediaType } from '@/features/preview/deps/media-library';
import { useItemsStore } from '@/features/preview/deps/timeline-store';
import { useSettingsStore } from '@/features/preview/deps/settings';
import { useEditorStore } from '@/app/state/editor';
import { useSourcePlayerStore } from '@/shared/state/source-player';
import { useSelectionStore } from '@/shared/state/selection';
import { EDITOR_LAYOUT_CSS_VALUES, getEditorLayout } from '@/app/editor-layout';
import { cn } from '@/shared/ui/cn';
import { formatTimecodeCompact } from '@/shared/utils/time-utils';
import type { TimelineTrack } from '@/types/timeline';

interface SourceMonitorProps {
  mediaId: string;
  onClose?: () => void;
  variant?: 'panel' | 'program';
  interactive?: boolean;
  seekFrame?: number | null;
}

const SOURCE_MONITOR_RESIZE_MIN_UPDATE_MS = 33;

function isPatchDestinationTrack(
  track: TimelineTrack | null,
  kind: 'video' | 'audio',
): track is TimelineTrack {
  if (!track || track.locked || track.isGroup) {
    return false;
  }

  const trackKind = getTrackKind(track);
  return trackKind === kind || trackKind === null;
}

function getPatchDestinationOptions(
  tracks: TimelineTrack[],
  kind: 'video' | 'audio',
): TimelineTrack[] {
  return [...tracks]
    .filter((track) => isPatchDestinationTrack(track, kind))
    .sort((a, b) => a.order - b.order);
}

function SourcePatchDestinationPicker({
  kind,
  label,
  selectedTrackId,
  options,
  onSelectTrack,
}: {
  kind: 'video' | 'audio';
  label: string;
  selectedTrackId: string | null;
  options: TimelineTrack[];
  onSelectTrack: (trackId: string | null) => void;
}) {
  const kindLabel = kind === 'video' ? 'Video' : 'Audio';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            'h-6 min-w-[3.75rem] justify-between gap-1 px-1.5 font-mono text-[10px]',
            !selectedTrackId && 'text-muted-foreground',
          )}
          aria-label={`Choose ${kindLabel.toLowerCase()} source patch destination`}
        >
          <span className="truncate">{label}</span>
          <ChevronDown className="h-3 w-3 shrink-0 opacity-70" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-40">
        <DropdownMenuLabel className="font-mono text-[10px] uppercase tracking-normal">
          {kindLabel} destination
        </DropdownMenuLabel>
        <DropdownMenuItem
          className={cn(
            'font-mono text-xs',
            selectedTrackId === null && 'bg-accent text-accent-foreground',
          )}
          onSelect={() => onSelectTrack(null)}
        >
          Auto
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {options.length > 0 ? options.map((track) => (
          <DropdownMenuItem
            key={track.id}
            className={cn(
              'font-mono text-xs',
              selectedTrackId === track.id && 'bg-accent text-accent-foreground',
            )}
            onSelect={() => onSelectTrack(track.id)}
          >
            {track.name}
          </DropdownMenuItem>
        )) : (
          <DropdownMenuItem disabled className="font-mono text-xs">
            Create on edit
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export const SourceMonitor = memo(function SourceMonitor({
  mediaId,
  onClose,
  variant = 'panel',
  interactive = true,
  seekFrame = null,
}: SourceMonitorProps) {
  return (
    <SourceMonitorContent
      key={mediaId}
      mediaId={mediaId}
      onClose={onClose}
      variant={variant}
      interactive={interactive}
      seekFrame={seekFrame}
    />
  );
});

const SourceMonitorContent = memo(function SourceMonitorContent({
  mediaId,
  onClose,
  variant = 'panel',
  interactive = true,
  seekFrame = null,
}: SourceMonitorProps) {
  const [blobUrl, setBlobUrl] = useState<string>('');
  const media = useMediaLibraryStore((s) => s.mediaItems.find((m) => m.id === mediaId));

  // Sync current media ID into source player store for I/O points
  useEffect(() => {
    if (!interactive) return;
    useSourcePlayerStore.getState().setCurrentMediaId(mediaId);
    return () => {
      // In React Strict Mode the source monitor may mount, clean up, and remount
      // while still representing the same open panel. Only release ownership once
      // the editor has actually switched away from this source monitor.
      if (useEditorStore.getState().sourcePreviewMediaId === mediaId) {
        return;
      }
      useSourcePlayerStore.getState().releaseCurrentMediaId(mediaId);
    };
  }, [interactive, mediaId]);

  // Auto-close if media is deleted
  useEffect(() => {
    if (!media) {
      onClose?.();
    }
  }, [media, onClose]);

  // Resolve the original source URL once. SourceComposition can swap to a
  // ready proxy for video preview without losing the original fallback URL.
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
            mediaId={mediaId}
            src={blobUrl}
            mediaType={mediaType}
            hasAudio={mediaType === 'video' && !!media.audioCodec}
            fileName={media.fileName}
            mediaWidth={mediaWidth}
            mediaHeight={mediaHeight}
            durationInFrames={durationInFrames}
            fps={fps}
            variant={variant}
            interactive={interactive}
            seekFrame={seekFrame}
            onClose={onClose}
          />
        </VideoConfigProvider>
      </ClockBridgeProvider>
    </PlayerEmitterProvider>
  );
});

// -- Inner component (rendered inside provider tree) --

interface SourceMonitorInnerProps {
  mediaId: string;
  src: string;
  mediaType: 'video' | 'audio' | 'image';
  hasAudio: boolean;
  fileName: string;
  mediaWidth: number;
  mediaHeight: number;
  durationInFrames: number;
  fps: number;
  variant: 'panel' | 'program';
  interactive: boolean;
  seekFrame: number | null;
  onClose?: () => void;
}

function SourceMonitorInner({
  mediaId,
  src,
  mediaType,
  hasAudio,
  fileName,
  mediaWidth,
  mediaHeight,
  durationInFrames,
  fps,
  variant,
  interactive,
  seekFrame,
  onClose,
}: SourceMonitorInnerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentHostRef = useRef<HTMLDivElement>(null);
  const contentScaleRef = useRef<HTMLDivElement>(null);
  const lastLayoutRef = useRef<{
    scaledWidth: number;
    scaledHeight: number;
    scale: number;
  } | null>(null);
  const editorDensity = useSettingsStore((s) => s.editorDensity);
  const editorLayout = getEditorLayout(editorDensity);

  const updateLayout = useCallback(() => {
    const container = containerRef.current;
    const host = contentHostRef.current;
    const scaleDiv = contentScaleRef.current;
    if (!container || !host || !scaleDiv) return;

    const cw = Math.max(0, container.clientWidth - editorLayout.previewPadding);
    const ch = Math.max(0, container.clientHeight - editorLayout.previewPadding);
    const scale = cw > 0 && ch > 0
      ? Math.min(cw / mediaWidth, ch / mediaHeight)
      : 1;

    const sw = mediaWidth * scale;
    const sh = mediaHeight * scale;

    const previousLayout = lastLayoutRef.current;
    if (
      previousLayout
      && previousLayout.scaledWidth === sw
      && previousLayout.scaledHeight === sh
      && previousLayout.scale === scale
    ) {
      return;
    }

    lastLayoutRef.current = {
      scaledWidth: sw,
      scaledHeight: sh,
      scale,
    };

    host.style.width = `${sw}px`;
    host.style.height = `${sh}px`;
    host.style.marginLeft = `${-sw / 2}px`;
    host.style.marginTop = `${-sh / 2}px`;

    scaleDiv.style.width = `${mediaWidth}px`;
    scaleDiv.style.height = `${mediaHeight}px`;
    scaleDiv.style.transform = `scale(${scale})`;
  }, [editorLayout.previewPadding, mediaWidth, mediaHeight]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let rafId: number | null = null;
    let lastUpdateTs = 0;
    const schedule = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        const now = performance.now();
        if (now - lastUpdateTs < SOURCE_MONITOR_RESIZE_MIN_UPDATE_MS) {
          rafId = requestAnimationFrame(() => {
            rafId = null;
            lastUpdateTs = performance.now();
            updateLayout();
          });
          return;
        }

        rafId = null;
        lastUpdateTs = now;
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
    if (!interactive) return;
    return () => {
      setHoveredPanel(null);
      setPlayerMethods(null);
    };
  }, [interactive, setHoveredPanel, setPlayerMethods]);

  // Handle I/O shortcuts locally on this element (not global useHotkeys)
  const wrapperRef = useRef<HTMLDivElement>(null);
  const hadFocusRef = useRef(false);
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!interactive) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    const { currentSourceFrame, setInPoint, setOutPoint, clearInOutPoints } = useSourcePlayerStore.getState();
    if (e.key === 'i' || e.key === 'I') {
      e.preventDefault();
      e.stopPropagation();
      setInPoint(currentSourceFrame);
    } else if (e.key === 'o' || e.key === 'O') {
      e.preventDefault();
      e.stopPropagation();
      setOutPoint(getExclusiveSourceOutPoint(currentSourceFrame, durationInFrames));
    } else if (e.altKey && (e.key === 'x' || e.key === 'X')) {
      e.preventDefault();
      e.stopPropagation();
      clearInOutPoints();
    }
  }, [durationInFrames, interactive]);

  const handleMouseEnter = useCallback(() => {
    if (!interactive) return;
    setHoveredPanel('source');
    // Only grab focus if nothing meaningful is focused (avoid stealing from inputs)
    const active = document.activeElement;
    if (active === document.body || wrapperRef.current?.contains(active)) {
      wrapperRef.current?.focus();
      hadFocusRef.current = true;
    }
  }, [interactive, setHoveredPanel]);

  const handleMouseLeave = useCallback(() => {
    if (!interactive) return;
    setHoveredPanel(null);
    if (hadFocusRef.current) {
      wrapperRef.current?.blur();
      hadFocusRef.current = false;
    }
  }, [interactive, setHoveredPanel]);

  return (
    <div
      ref={wrapperRef}
      tabIndex={-1}
      className="flex-1 flex flex-col min-w-0 outline-none"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onKeyDown={handleKeyDown}
    >
      {variant === 'panel' && (
        <div
          className="border-b border-border flex items-center px-3 justify-between shrink-0"
          style={{ height: EDITOR_LAYOUT_CSS_VALUES.previewSplitHeaderHeight }}
        >
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
      )}

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
                mediaId={mediaId}
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

      {/* Controls bar - same height as program monitor */}
      <SourcePlaybackControls
        durationInFrames={durationInFrames}
        fps={fps}
        mediaType={mediaType}
        hasAudio={hasAudio}
        interactive={interactive}
        seekFrame={seekFrame}
      />
    </div>
  );
}

// -- Playback controls for the source monitor --

function SourcePlaybackControls({
  durationInFrames,
  fps,
  mediaType,
  hasAudio,
  interactive,
  seekFrame,
}: {
  durationInFrames: number;
  fps: number;
  mediaType: 'video' | 'audio' | 'image';
  hasAudio: boolean;
  interactive: boolean;
  seekFrame: number | null;
}) {
  const clock = useClock();
  const player = usePlayer(durationInFrames);
  const playing = useClockIsPlaying();
  const lastFrame = Math.max(0, durationInFrames - 1);
  const tracks = useItemsStore((s) => s.tracks);
  const activeTrackId = useSelectionStore((s) => s.activeTrackId);
  const sourcePatchVideoEnabled = useEditorStore((s) => s.sourcePatchVideoEnabled);
  const sourcePatchAudioEnabled = useEditorStore((s) => s.sourcePatchAudioEnabled);
  const sourcePatchVideoTrackId = useEditorStore((s) => s.sourcePatchVideoTrackId);
  const sourcePatchAudioTrackId = useEditorStore((s) => s.sourcePatchAudioTrackId);
  const setSourcePatchVideoTrackId = useEditorStore((s) => s.setSourcePatchVideoTrackId);
  const setSourcePatchAudioTrackId = useEditorStore((s) => s.setSourcePatchAudioTrackId);
  const toggleSourcePatchVideoEnabled = useEditorStore((s) => s.toggleSourcePatchVideoEnabled);
  const toggleSourcePatchAudioEnabled = useEditorStore((s) => s.toggleSourcePatchAudioEnabled);
  const currentFrameRef = useRef(clock.currentFrame);
  const progressRef = useRef<HTMLDivElement>(null);
  const currentTimeRef = useRef<HTMLSpanElement>(null);
  const outPointRef = useRef<number | null>(useSourcePlayerStore.getState().outPoint);
  const [showFrames, setShowFrames] = useState(false);
  const showFramesRef = useRef(showFrames);
  showFramesRef.current = showFrames;

  const frameDigits = Math.max(durationInFrames.toString().length, 1);

  const formatFrameNumber = useCallback(
    (f: number) => f.toString().padStart(frameDigits, '0'),
    [frameDigits],
  );

  const formatTime = useCallback(
    (f: number) => (showFramesRef.current ? formatFrameNumber(f) : formatTimecodeCompact(f, fps)),
    [fps, formatFrameNumber],
  );

  const updateFrameDisplay = useCallback((frame: number) => {
    currentFrameRef.current = frame;
    if (interactive) {
      useSourcePlayerStore.getState().setCurrentSourceFrame(frame);
    }
    if (progressRef.current) {
      const progress = lastFrame > 0 ? (frame / lastFrame) * 100 : 0;
      progressRef.current.style.width = `${progress}%`;
    }
    if (currentTimeRef.current) {
      currentTimeRef.current.textContent = showFramesRef.current
        ? formatFrameNumber(frame)
        : formatTimecodeCompact(frame, fps);
    }
  }, [fps, formatFrameNumber, interactive, lastFrame]);

  // Bridge player methods into the source player store for keyboard shortcuts
  useEffect(() => {
    if (!interactive) return;
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
  }, [durationInFrames, interactive, player.toggle, player.seek, player.frameBack, player.frameForward]);

  useEffect(() => {
    updateFrameDisplay(clock.currentFrame);
    return clock.onFrameChange((frame) => {
      updateFrameDisplay(frame);

      if (replayingRef.current && clock.isPlaying && outPointRef.current !== null && frame >= outPointRef.current) {
        player.pause();
        replayingRef.current = false;
      }
    });
  }, [clock, player, updateFrameDisplay]);

  // Consume pending seek (e.g. double-click opens clip at its In point)
  const pendingSeekFrame = useSourcePlayerStore((s) => s.pendingSeekFrame);
  useEffect(() => {
    if (!interactive) return;
    if (pendingSeekFrame !== null) {
      player.seek(pendingSeekFrame);
      useSourcePlayerStore.getState().setPendingSeekFrame(null);
    }
  }, [interactive, pendingSeekFrame, player]);

  useEffect(() => {
    if (seekFrame === null) return;
    player.seek(seekFrame);
  }, [player, seekFrame]);

  // Read I/O points from store
  const inPoint = useSourcePlayerStore((s) => s.inPoint);
  const outPoint = useSourcePlayerStore((s) => s.outPoint);
  useEffect(() => {
    outPointRef.current = outPoint;
  }, [outPoint]);

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

  // I/O marker positions as percentages
  const inPct = interactive ? getSourcePointPercent(inPoint, durationInFrames) : null;
  const outPct = interactive ? getSourcePointPercent(outPoint, durationInFrames) : null;

  // Draggable I/O handles + range
  const ioStripRef = useRef<HTMLDivElement>(null);
  const ioDragCleanupRef = useRef<(() => void) | null>(null);

  const pointFromStripX = useCallback(
    (clientX: number) => {
      const strip = ioStripRef.current;
      if (!strip) return 0;
      const rect = strip.getBoundingClientRect();
      if (rect.width <= 0) return 0;
      return getSourceStripPointFromRatio((clientX - rect.left) / rect.width, durationInFrames);
    },
    [durationInFrames],
  );

  const handleIODragStart = useCallback(
    (e: React.MouseEvent, type: 'in' | 'out') => {
      e.preventDefault();
      e.stopPropagation();
      const originalCursor = document.body.style.cursor;
      document.body.style.cursor = 'col-resize';

      const store = useSourcePlayerStore.getState;
      const onMove = (ev: MouseEvent) => {
        const point = pointFromStripX(ev.clientX);
        if (type === 'in') {
          const out = store().outPoint;
          store().setInPoint(clampDraggedSourceInPoint(point, out, lastFrame));
        } else {
          const inp = store().inPoint;
          store().setOutPoint(clampDraggedSourceOutPoint(point, inp, durationInFrames));
        }
      };
      const onUp = () => {
        document.body.style.cursor = originalCursor;
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        ioDragCleanupRef.current = null;
      };
      ioDragCleanupRef.current = onUp;
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [durationInFrames, lastFrame, pointFromStripX],
  );

  const handleIORangeDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const store = useSourcePlayerStore.getState;
      const startIn = store().inPoint;
      const startOut = store().outPoint;
      if (startIn === null || startOut === null) return;
      const startPoint = pointFromStripX(e.clientX);
      const originalCursor = document.body.style.cursor;
      document.body.style.cursor = 'grabbing';

      const onMove = (ev: MouseEvent) => {
        const nowPoint = pointFromStripX(ev.clientX);
        const delta = nowPoint - startPoint;
        const nextRange = shiftSourceIoRange(startIn, startOut, delta, durationInFrames);
        store().setInPoint(nextRange.inPoint);
        store().setOutPoint(nextRange.outPoint);
      };
      const onUp = () => {
        document.body.style.cursor = originalCursor;
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        ioDragCleanupRef.current = null;
      };
      ioDragCleanupRef.current = onUp;
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [durationInFrames, pointFromStripX],
  );

  useEffect(() => {
    return () => ioDragCleanupRef.current?.();
  }, []);

  // Duration display when both I/O are set
  const ioDuration = interactive && inPoint !== null && outPoint !== null
    ? formatTime(outPoint - inPoint)
    : null;

  const handleMarkIn = useCallback(() => {
    useSourcePlayerStore.getState().setInPoint(currentFrameRef.current);
  }, []);

  const handleMarkOut = useCallback(() => {
    useSourcePlayerStore.getState().setOutPoint(
      getExclusiveSourceOutPoint(currentFrameRef.current, durationInFrames),
    );
  }, [durationInFrames]);

  const handleClearIO = useCallback(() => {
    useSourcePlayerStore.getState().clearInOutPoints();
  }, []);

  // Auto-stop playback at out point
  const replayingRef = useRef(false);

  useEffect(() => {
    if (!playing) {
      replayingRef.current = false;
    }
  }, [playing]);

  const handleReplaySegment = useCallback(() => {
    const { inPoint: ip, outPoint: op } = useSourcePlayerStore.getState();
    if (ip === null && op === null) return;
    replayingRef.current = true;
    player.seek(ip ?? 0);
    player.play();
  }, [player]);

  const activeTrack = useMemo(
    () => (activeTrackId ? tracks.find((track) => track.id === activeTrackId) ?? null : null),
    [activeTrackId, tracks],
  );
  const selectedVideoTrack = useMemo(
    () => (sourcePatchVideoTrackId ? tracks.find((track) => track.id === sourcePatchVideoTrackId) ?? null : null),
    [sourcePatchVideoTrackId, tracks],
  );
  const selectedAudioTrack = useMemo(
    () => (sourcePatchAudioTrackId ? tracks.find((track) => track.id === sourcePatchAudioTrackId) ?? null : null),
    [sourcePatchAudioTrackId, tracks],
  );
  const videoDestinationOptions = useMemo(
    () => getPatchDestinationOptions(tracks, 'video'),
    [tracks],
  );
  const audioDestinationOptions = useMemo(
    () => getPatchDestinationOptions(tracks, 'audio'),
    [tracks],
  );

  useEffect(() => {
    if (!interactive || !activeTrackId || !activeTrack || activeTrack.locked) {
      return;
    }

    const currentState = useEditorStore.getState();
    const hasVideoDestination = isPatchDestinationTrack(
      tracks.find((track) => track.id === currentState.sourcePatchVideoTrackId) ?? null,
      'video',
    );
    const hasAudioDestination = isPatchDestinationTrack(
      tracks.find((track) => track.id === currentState.sourcePatchAudioTrackId) ?? null,
      'audio',
    );
    const activeTrackKind = getTrackKind(activeTrack);
    if (activeTrackKind === 'audio') {
      if (!hasAudioDestination) {
        setSourcePatchAudioTrackId(activeTrackId);
      }
      return;
    }

    if (activeTrackKind === 'video') {
      if (!hasVideoDestination) {
        setSourcePatchVideoTrackId(activeTrackId);
      }
      return;
    }

    if (mediaType === 'audio' && !hasAudioDestination) {
      setSourcePatchAudioTrackId(activeTrackId);
    } else if (mediaType !== 'audio' && !hasVideoDestination) {
      setSourcePatchVideoTrackId(activeTrackId);
    }
  }, [
    activeTrack,
    activeTrackId,
    interactive,
    mediaType,
    setSourcePatchAudioTrackId,
    setSourcePatchVideoTrackId,
    tracks,
  ]);

  const patchTargetPreview = useMemo(() => {
    const resolvedTargets = resolveSourceEditTrackTargets({
      tracks,
      activeTrackId,
      preferredVideoTrackId: sourcePatchVideoTrackId,
      preferredAudioTrackId: sourcePatchAudioTrackId,
      mediaType,
      hasAudio,
      patchVideo: sourcePatchVideoEnabled,
      patchAudio: sourcePatchAudioEnabled,
      preferredTrackHeight: activeTrack?.height ?? selectedVideoTrack?.height ?? selectedAudioTrack?.height ?? tracks[0]?.height ?? 64,
    });

    if (!resolvedTargets) {
      return {
        videoTargetName: null,
        audioTargetName: null,
        status: null,
      };
    }

    const resolvedTracks = resolvedTargets.tracks;
    return {
      videoTargetName: resolvedTargets.videoTrackId
        ? resolvedTracks.find((track) => track.id === resolvedTargets.videoTrackId)?.name ?? null
        : null,
      audioTargetName: resolvedTargets.audioTrackId
        ? resolvedTracks.find((track) => track.id === resolvedTargets.audioTrackId)?.name ?? null
        : null,
      status: null,
    };
  }, [
    activeTrack,
    activeTrackId,
    hasAudio,
    mediaType,
    selectedAudioTrack,
    selectedVideoTrack,
    sourcePatchAudioEnabled,
    sourcePatchAudioTrackId,
    sourcePatchVideoEnabled,
    sourcePatchVideoTrackId,
    tracks,
  ]);

  const videoDestinationLabel = selectedVideoTrack?.name ?? patchTargetPreview.videoTargetName ?? 'Auto';
  const audioDestinationLabel = selectedAudioTrack?.name ?? patchTargetPreview.audioTargetName ?? 'Auto';

  const videoPatchTooltip = patchTargetPreview.videoTargetName
    ? `Video Source Patch On -> ${patchTargetPreview.videoTargetName}`
    : sourcePatchVideoEnabled
      ? 'Video Source Patch On'
      : 'Video Source Patch Off';
  const audioPatchTooltip = patchTargetPreview.audioTargetName
    ? `Audio Source Patch On -> ${patchTargetPreview.audioTargetName}`
    : sourcePatchAudioEnabled
      ? 'Audio Source Patch On'
      : 'Audio Source Patch Off';

  return (
    <div className="@container flex flex-col shrink-0">
      {/* Seek bar row with I/O region above and editing buttons */}
      <div className="border-t border-border panel-header flex items-center gap-2 px-4 h-7 shrink-0">
        <div className="flex-1 flex flex-col justify-center gap-[2px] min-w-0">
          {/* I/O region strip — styled like timeline I/O controls */}
          {interactive && (inPct !== null || outPct !== null) && (
            <div ref={ioStripRef} className="w-full h-2.5 relative shrink-0">
              {/* Draggable range strip */}
              {inPct !== null && outPct !== null && (
                <div
                  className="absolute inset-y-0 cursor-grab active:cursor-grabbing"
                  style={{
                    left: `${inPct}%`,
                    width: `${Math.max(0.5, outPct - inPct)}%`,
                    background:
                      'linear-gradient(to bottom, var(--color-timeline-io-range-fill), color-mix(in oklch, var(--color-timeline-io-range-fill) 82%, black))',
                    border: '1px solid var(--color-timeline-io-range-border)',
                    borderRadius: '2px',
                    boxShadow:
                      'inset 0 1px 0 color-mix(in oklch, white 22%, transparent), 0 0 6px var(--color-timeline-io-range-glow)',
                    zIndex: 10,
                  }}
                  onMouseDown={handleIORangeDragStart}
                />
              )}
              {/* In handle — grip */}
              {inPct !== null && (
                <div
                  className="absolute top-0 bottom-0"
                  style={{
                    left: `${inPct}%`,
                    width: '5px',
                    borderRadius: '2px',
                    background: `linear-gradient(to bottom, var(--color-timeline-io-handle), color-mix(in oklch, var(--color-timeline-io-handle) 75%, black))`,
                    boxShadow: `0 0 5px color-mix(in oklch, var(--color-timeline-io-handle) 55%, transparent)`,
                    zIndex: 20,
                    pointerEvents: 'none',
                  }}
                />
              )}
              {/* In handle hit area */}
              {inPct !== null && (
                <div
                  className="absolute cursor-col-resize"
                  style={{
                    left: `calc(${inPct}% - 4px)`,
                    top: 0,
                    bottom: 0,
                    width: '14px',
                    zIndex: 21,
                  }}
                  onMouseDown={(e) => handleIODragStart(e, 'in')}
                />
              )}
              {/* Out handle — grip */}
              {outPct !== null && (
                <div
                  className="absolute top-0 bottom-0"
                  style={{
                    left: `${outPct}%`,
                    width: '5px',
                    transform: 'translateX(-100%)',
                    borderRadius: '2px',
                    background: `linear-gradient(to bottom, var(--color-timeline-io-handle), color-mix(in oklch, var(--color-timeline-io-handle) 75%, black))`,
                    boxShadow: `0 0 5px color-mix(in oklch, var(--color-timeline-io-handle) 55%, transparent)`,
                    zIndex: 20,
                    pointerEvents: 'none',
                  }}
                />
              )}
              {/* Out handle hit area */}
              {outPct !== null && (
                <div
                  className="absolute cursor-col-resize"
                  style={{
                    left: `calc(${outPct}% - 10px)`,
                    top: 0,
                    bottom: 0,
                    width: '14px',
                    zIndex: 21,
                  }}
                  onMouseDown={(e) => handleIODragStart(e, 'out')}
                />
              )}
            </div>
          )}
          {/* Seek bar */}
          <div
            ref={barRef}
            className="w-full h-1.5 bg-muted rounded cursor-pointer relative"
            onMouseDown={handleBarMouseDown}
          >
            <div
              ref={progressRef}
              className="absolute inset-y-0 left-0 bg-primary transition-none pointer-events-none rounded-l"
              style={{ width: `${lastFrame > 0 ? (clock.currentFrame / lastFrame) * 100 : 0}%` }}
            />
          </div>
        </div>
        {interactive && (
          <div className="flex items-center gap-0.5 shrink-0">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  style={{ width: EDITOR_LAYOUT_CSS_VALUES.toolbarButtonSize, height: EDITOR_LAYOUT_CSS_VALUES.toolbarButtonSize }}
                  disabled={inPoint === null && outPoint === null}
                  onClick={handleReplaySegment}
                >
                  <Repeat className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">Play In to Out</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" style={{ width: EDITOR_LAYOUT_CSS_VALUES.toolbarButtonSize, height: EDITOR_LAYOUT_CSS_VALUES.toolbarButtonSize }} onClick={handleMarkIn}>
                  <ArrowLeftToLine className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">Mark In (I)</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" style={{ width: EDITOR_LAYOUT_CSS_VALUES.toolbarButtonSize, height: EDITOR_LAYOUT_CSS_VALUES.toolbarButtonSize }} onClick={handleMarkOut}>
                  <ArrowRightToLine className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">Mark Out (O)</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" style={{ width: EDITOR_LAYOUT_CSS_VALUES.toolbarButtonSize, height: EDITOR_LAYOUT_CSS_VALUES.toolbarButtonSize }} onClick={handleClearIO}>
                  <XCircle className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">Clear In/Out (Alt+X)</TooltipContent>
            </Tooltip>
          </div>
        )}
      </div>

      {/* Transport row */}
      <div
        className="border-t border-border panel-header flex items-center justify-between px-4 shrink-0"
        style={{ height: EDITOR_LAYOUT_CSS_VALUES.previewControlsHeight }}
      >
        <button
          type="button"
          className="inline-flex items-center gap-1.5 bg-transparent p-0 font-mono text-[11px] tabular-nums text-left transition-colors select-none text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-sm shrink-0"
          onClick={() => setShowFrames((prev) => !prev)}
        >
          <span ref={currentTimeRef} className="text-primary font-semibold">
            {formatTime(clock.currentFrame)}
          </span>
          <span className="text-muted-foreground/50">/</span>
          <span>{formatTime(lastFrame)}</span>
        </button>
        <span className="text-[11px] font-mono text-primary/70 shrink-0 hidden @min-[480px]:inline">
          {ioDuration ? `[${ioDuration}]` : ''}
        </span>

        <div className="flex items-center gap-0.5 shrink-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" style={{ width: EDITOR_LAYOUT_CSS_VALUES.toolbarButtonSize, height: EDITOR_LAYOUT_CSS_VALUES.toolbarButtonSize }} onClick={() => player.seek(0)}>
                <SkipBack className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Go to start (Home)</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" style={{ width: EDITOR_LAYOUT_CSS_VALUES.toolbarButtonSize, height: EDITOR_LAYOUT_CSS_VALUES.toolbarButtonSize }} onClick={() => player.frameBack(1)}>
                <ChevronLeft className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Previous frame (Left Arrow)</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon" style={{ width: EDITOR_LAYOUT_CSS_VALUES.toolbarButtonSize, height: EDITOR_LAYOUT_CSS_VALUES.toolbarButtonSize }} onClick={() => player.toggle()}>
                {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 ml-0.5" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">{playing ? 'Pause' : 'Play'} (Space)</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" style={{ width: EDITOR_LAYOUT_CSS_VALUES.toolbarButtonSize, height: EDITOR_LAYOUT_CSS_VALUES.toolbarButtonSize }} onClick={() => player.frameForward(1)}>
                <ChevronRight className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Next frame (Right Arrow)</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" style={{ width: EDITOR_LAYOUT_CSS_VALUES.toolbarButtonSize, height: EDITOR_LAYOUT_CSS_VALUES.toolbarButtonSize }} onClick={() => player.seek(lastFrame)}>
                <SkipForward className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Go to end (End)</TooltipContent>
          </Tooltip>
        </div>

        {interactive ? (
          <div className="flex items-center gap-0.5 shrink-0">
            <div className="flex items-center gap-1 shrink-0">
              <div className="flex items-center gap-0.5 rounded-md border border-border bg-secondary/50 px-1 py-0.5">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className={`h-6 min-w-6 px-1.5 font-mono text-[11px] ${
                        sourcePatchVideoEnabled ? 'bg-primary text-primary-foreground hover:bg-primary/90' : ''
                      }`}
                      onClick={toggleSourcePatchVideoEnabled}
                      aria-label={sourcePatchVideoEnabled ? 'Disable video source patch target' : 'Enable video source patch target'}
                      aria-pressed={sourcePatchVideoEnabled}
                    >
                      V
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">{videoPatchTooltip}</TooltipContent>
                </Tooltip>
                <SourcePatchDestinationPicker
                  kind="video"
                  label={videoDestinationLabel}
                  selectedTrackId={sourcePatchVideoTrackId}
                  options={videoDestinationOptions}
                  onSelectTrack={setSourcePatchVideoTrackId}
                />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className={`h-6 min-w-6 px-1.5 font-mono text-[11px] ${
                        sourcePatchAudioEnabled ? 'bg-primary text-primary-foreground hover:bg-primary/90' : ''
                      }`}
                      onClick={toggleSourcePatchAudioEnabled}
                      aria-label={sourcePatchAudioEnabled ? 'Disable audio source patch target' : 'Enable audio source patch target'}
                      aria-pressed={sourcePatchAudioEnabled}
                    >
                      A
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">{audioPatchTooltip}</TooltipContent>
                </Tooltip>
                <SourcePatchDestinationPicker
                  kind="audio"
                  label={audioDestinationLabel}
                  selectedTrackId={sourcePatchAudioTrackId}
                  options={audioDestinationOptions}
                  onSelectTrack={setSourcePatchAudioTrackId}
                />
              </div>
              {/* V/A preview labels: hidden at narrow widths, info still in menus/tooltips */}
              {patchTargetPreview.videoTargetName || patchTargetPreview.audioTargetName ? (
                <div className="hidden @min-[560px]:flex items-center gap-1 text-[10px] font-mono text-muted-foreground whitespace-nowrap">
                  {patchTargetPreview.videoTargetName ? (
                    <span className="rounded border border-border/70 bg-secondary/60 px-1.5 py-0.5">
                      {'V->'}{patchTargetPreview.videoTargetName}
                    </span>
                  ) : null}
                  {patchTargetPreview.audioTargetName ? (
                    <span className="rounded border border-border/70 bg-secondary/60 px-1.5 py-0.5">
                      {'A->'}{patchTargetPreview.audioTargetName}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="w-px h-4 bg-border mx-0.5" />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" style={{ width: EDITOR_LAYOUT_CSS_VALUES.toolbarButtonSize, height: EDITOR_LAYOUT_CSS_VALUES.toolbarButtonSize }} onClick={() => performInsertEdit()}>
                  <ArrowDownToLine className="w-3.5 h-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">Insert (,)</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" style={{ width: EDITOR_LAYOUT_CSS_VALUES.toolbarButtonSize, height: EDITOR_LAYOUT_CSS_VALUES.toolbarButtonSize }} onClick={() => performOverwriteEdit()}>
                  <Replace className="w-3.5 h-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">Overwrite (.)</TooltipContent>
            </Tooltip>
          </div>
        ) : (
          <div className="w-[11ch] shrink-0" aria-hidden="true" />
        )}
      </div>
    </div>
  );
}
