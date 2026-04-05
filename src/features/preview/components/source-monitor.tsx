import { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react';
import { X, Play, Pause, SkipBack, SkipForward, ChevronLeft, ChevronRight, Repeat, ArrowLeftToLine, ArrowRightToLine, XCircle, ArrowDownToLine, Replace } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import {
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
} from '@/features/preview/deps/transport-context';
import { SourceComposition } from './source-composition';
import { resolveMediaUrl } from '../utils/media-resolver';
import { useMediaLibraryStore, getMediaType } from '@/features/preview/deps/media-library';
import { useItemsStore } from '@/features/preview/deps/timeline-store';
import { useSettingsStore } from '@/features/preview/deps/settings';
import { useEditorStore } from '@/shared/state/editor';
import { useSourceMonitorStore } from '@/shared/state/source-monitor';
import { useSelectionStore } from '@/shared/state/selection';
import { EDITOR_LAYOUT_CSS_VALUES, getEditorLayout } from '@/shared/ui/editor-layout';
import { formatTimecodeCompact } from '@/utils/time-utils';

interface SourceMonitorProps {
  mediaId: string;
  onClose?: () => void;
  variant?: 'panel' | 'program';
  interactive?: boolean;
  seekFrame?: number | null;
}

const SOURCE_MONITOR_RESIZE_MIN_UPDATE_MS = 33;

export const SourceMonitor = memo(function SourceMonitor({
  mediaId,
  onClose,
  variant = 'panel',
  interactive = true,
  seekFrame = null,
}: SourceMonitorProps) {
  const [blobUrl, setBlobUrl] = useState<string>('');
  const media = useMediaLibraryStore((s) => s.mediaItems.find((m) => m.id === mediaId));

  // Sync current media ID into source monitor state for I/O points.
  useEffect(() => {
    if (!interactive) return;
    useSourceMonitorStore.getState().setCurrentMediaId(mediaId);
    return () => {
      useSourceMonitorStore.getState().setCurrentMediaId(null);
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

  const setHoveredPanel = useSourceMonitorStore((s) => s.setHoveredPanel);
  const setTransportMethods = useSourceMonitorStore((s) => s.setTransportMethods);

  // Reset hover and transport methods on unmount.
  useEffect(() => {
    if (!interactive) return;
    return () => {
      setHoveredPanel(null);
      setTransportMethods(null);
    };
  }, [interactive, setHoveredPanel, setTransportMethods]);

  // Handle I/O shortcuts locally on this element (not global useHotkeys)
  const wrapperRef = useRef<HTMLDivElement>(null);
  const hadFocusRef = useRef(false);
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!interactive) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    const { currentSourceFrame, setInPoint, setOutPoint, clearInOutPoints } = useSourceMonitorStore.getState();
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
  }, [interactive]);

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
  const transport = usePlayer(durationInFrames);
  const playing = useClockIsPlaying();
  const lastFrame = Math.max(0, durationInFrames - 1);
  const tracks = useItemsStore((s) => s.tracks);
  const activeTrackId = useSelectionStore((s) => s.activeTrackId);
  const sourcePatchVideoEnabled = useEditorStore((s) => s.sourcePatchVideoEnabled);
  const sourcePatchAudioEnabled = useEditorStore((s) => s.sourcePatchAudioEnabled);
  const toggleSourcePatchVideoEnabled = useEditorStore((s) => s.toggleSourcePatchVideoEnabled);
  const toggleSourcePatchAudioEnabled = useEditorStore((s) => s.toggleSourcePatchAudioEnabled);
  const currentFrameRef = useRef(clock.currentFrame);
  const progressRef = useRef<HTMLDivElement>(null);
  const currentTimeRef = useRef<HTMLSpanElement>(null);
  const outPointRef = useRef<number | null>(useSourceMonitorStore.getState().outPoint);
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
      useSourceMonitorStore.getState().setCurrentSourceFrame(frame);
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

  // Bridge transport methods into the source monitor store for keyboard shortcuts.
  useEffect(() => {
    if (!interactive) return;
    const setTransportMethods = useSourceMonitorStore.getState().setTransportMethods;
    setTransportMethods({
      toggle: transport.toggle,
      seek: transport.seek,
      frameBack: transport.frameBack,
      frameForward: transport.frameForward,
      getDurationInFrames: () => durationInFrames,
    });
    return () => {
      useSourceMonitorStore.getState().setTransportMethods(null);
    };
  }, [durationInFrames, interactive, transport.toggle, transport.seek, transport.frameBack, transport.frameForward]);

  useEffect(() => {
    updateFrameDisplay(clock.currentFrame);
    return clock.onFrameChange((frame) => {
      updateFrameDisplay(frame);

      if (replayingRef.current && clock.isPlaying && outPointRef.current !== null && frame >= outPointRef.current) {
        transport.pause();
        replayingRef.current = false;
      }
    });
  }, [clock, transport, updateFrameDisplay]);

  // Consume pending seek (e.g. double-click opens clip at its In point)
  const pendingSeekFrame = useSourceMonitorStore((s) => s.pendingSeekFrame);
  useEffect(() => {
    if (!interactive) return;
    if (pendingSeekFrame !== null) {
      transport.seek(pendingSeekFrame);
      useSourceMonitorStore.getState().setPendingSeekFrame(null);
    }
  }, [interactive, pendingSeekFrame, transport]);

  useEffect(() => {
    if (seekFrame === null) return;
    transport.seek(seekFrame);
  }, [seekFrame, transport]);

  // Read I/O points from store
  const inPoint = useSourceMonitorStore((s) => s.inPoint);
  const outPoint = useSourceMonitorStore((s) => s.outPoint);
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
      transport.seek(Math.round(pct * lastFrame));
    },
    [lastFrame, transport],
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
  const inPct = interactive && inPoint !== null && lastFrame > 0 ? (inPoint / lastFrame) * 100 : null;
  const outPct = interactive && outPoint !== null && lastFrame > 0 ? (outPoint / lastFrame) * 100 : null;

  // Draggable I/O handles + range
  const ioStripRef = useRef<HTMLDivElement>(null);
  const ioDragCleanupRef = useRef<(() => void) | null>(null);

  const frameFromStripX = useCallback(
    (clientX: number) => {
      const strip = ioStripRef.current;
      if (!strip) return 0;
      const rect = strip.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return Math.round(pct * lastFrame);
    },
    [lastFrame],
  );

  const handleIODragStart = useCallback(
    (e: React.MouseEvent, type: 'in' | 'out') => {
      e.preventDefault();
      e.stopPropagation();
      const originalCursor = document.body.style.cursor;
      document.body.style.cursor = 'col-resize';

      const store = useSourceMonitorStore.getState;
      const onMove = (ev: MouseEvent) => {
        const frame = frameFromStripX(ev.clientX);
        if (type === 'in') {
          const out = store().outPoint;
          store().setInPoint(out !== null ? Math.min(frame, out) : frame);
        } else {
          const inp = store().inPoint;
          store().setOutPoint(inp !== null ? Math.max(frame, inp) : frame);
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
    [frameFromStripX],
  );

  const handleIORangeDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const store = useSourceMonitorStore.getState;
      const startIn = store().inPoint;
      const startOut = store().outPoint;
      if (startIn === null || startOut === null) return;
      const startFrame = frameFromStripX(e.clientX);
      const originalCursor = document.body.style.cursor;
      document.body.style.cursor = 'grabbing';

      const onMove = (ev: MouseEvent) => {
        const nowFrame = frameFromStripX(ev.clientX);
        const delta = nowFrame - startFrame;
        const nextIn = Math.max(0, Math.min(lastFrame, startIn + delta));
        const nextOut = Math.max(0, Math.min(lastFrame, startOut + delta));
        if (nextIn > nextOut) return;
        store().setInPoint(nextIn);
        store().setOutPoint(nextOut);
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
    [frameFromStripX, lastFrame],
  );

  useEffect(() => {
    return () => ioDragCleanupRef.current?.();
  }, []);

  // Duration display when both I/O are set
  const ioDuration = interactive && inPoint !== null && outPoint !== null
    ? formatTime(outPoint - inPoint)
    : null;

  const handleMarkIn = useCallback(() => {
    useSourceMonitorStore.getState().setInPoint(currentFrameRef.current);
  }, []);

  const handleMarkOut = useCallback(() => {
    useSourceMonitorStore.getState().setOutPoint(currentFrameRef.current);
  }, []);

  const handleClearIO = useCallback(() => {
    useSourceMonitorStore.getState().clearInOutPoints();
  }, []);

  // Auto-stop playback at out point
  const replayingRef = useRef(false);

  useEffect(() => {
    if (!playing) {
      replayingRef.current = false;
    }
  }, [playing]);

  const handleReplaySegment = useCallback(() => {
    const { inPoint: ip, outPoint: op } = useSourceMonitorStore.getState();
    if (ip === null && op === null) return;
    replayingRef.current = true;
    transport.seek(ip ?? 0);
    transport.play();
  }, [transport]);

  const activeTrack = useMemo(
    () => (activeTrackId ? tracks.find((track) => track.id === activeTrackId) ?? null : null),
    [activeTrackId, tracks],
  );

  const patchTargetPreview = useMemo(() => {
    if (!activeTrackId || !activeTrack) {
      return {
        videoTargetName: null,
        audioTargetName: null,
        status: 'Select target track',
      };
    }

    if (activeTrack.locked) {
      return {
        videoTargetName: null,
        audioTargetName: null,
        status: 'Target track locked',
      };
    }

    const resolvedTargets = resolveSourceEditTrackTargets({
      tracks,
      activeTrackId,
      mediaType,
      hasAudio,
      patchVideo: sourcePatchVideoEnabled,
      patchAudio: sourcePatchAudioEnabled,
      preferredTrackHeight: activeTrack.height,
    });

    if (!resolvedTargets) {
      let status = 'Enable V and/or A';
      if (mediaType === 'audio' && !sourcePatchAudioEnabled) {
        status = 'Enable A';
      } else if ((mediaType === 'video' || mediaType === 'image') && !sourcePatchVideoEnabled && !hasAudio) {
        status = 'Enable V';
      }

      return {
        videoTargetName: null,
        audioTargetName: null,
        status,
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
    sourcePatchAudioEnabled,
    sourcePatchVideoEnabled,
    tracks,
  ]);

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
          {/* I/O region strip — styled like timeline I/O controls */}
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
              {/* In handle — grip */}
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
              {/* Out handle — grip */}
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
              <Button variant="ghost" size="icon" style={{ width: EDITOR_LAYOUT_CSS_VALUES.toolbarButtonSize, height: EDITOR_LAYOUT_CSS_VALUES.toolbarButtonSize }} onClick={() => transport.seek(0)}>
                <SkipBack className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Go to start (Home)</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" style={{ width: EDITOR_LAYOUT_CSS_VALUES.toolbarButtonSize, height: EDITOR_LAYOUT_CSS_VALUES.toolbarButtonSize }} onClick={() => transport.frameBack(1)}>
                <ChevronLeft className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Previous frame (←)</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon" style={{ width: EDITOR_LAYOUT_CSS_VALUES.toolbarButtonSize, height: EDITOR_LAYOUT_CSS_VALUES.toolbarButtonSize }} onClick={() => transport.toggle()}>
                {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 ml-0.5" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">{playing ? 'Pause' : 'Play'} (Space)</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" style={{ width: EDITOR_LAYOUT_CSS_VALUES.toolbarButtonSize, height: EDITOR_LAYOUT_CSS_VALUES.toolbarButtonSize }} onClick={() => transport.frameForward(1)}>
                <ChevronRight className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Next frame (→)</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" style={{ width: EDITOR_LAYOUT_CSS_VALUES.toolbarButtonSize, height: EDITOR_LAYOUT_CSS_VALUES.toolbarButtonSize }} onClick={() => transport.seek(lastFrame)}>
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
              </div>
              {/* V/A target labels — hidden at narrow widths, info still in tooltips */}
              {patchTargetPreview.status ? (
                <span className="text-[10px] font-mono text-muted-foreground whitespace-nowrap hidden @min-[560px]:inline">
                  {patchTargetPreview.status}
                </span>
              ) : (
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
              )}
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
