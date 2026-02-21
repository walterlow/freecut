import { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { useRollingEditPreviewStore } from '@/features/timeline/stores/rolling-edit-preview-store';
import { useTimelineStore } from '@/features/timeline/stores/timeline-store';
import { getVideoTargetTimeSeconds } from '@/lib/composition-runtime/utils/video-timing';
import { formatTimecode } from '@/utils/time-utils';
import { resolveMediaUrl } from '../utils/media-resolver';
import type { TimelineItem } from '@/types/timeline';

// Colors for non-video clip type placeholders
const TYPE_PLACEHOLDER_COLORS: Record<string, string> = {
  image: '#22c55e',
  text: '#f59e0b',
  shape: '#8b5cf6',
  adjustment: '#6b7280',
  composition: '#3b82f6',
  audio: '#ec4899',
};

interface RollingEditOverlayProps {
  fps: number;
}

/**
 * 2-up frame comparison overlay shown during rolling edits.
 * Displays the outgoing frame (last frame of left clip) and incoming frame
 * (first frame of right clip) at the current edit point, with SMPTE timecodes.
 */
export function RollingEditOverlay({ fps }: RollingEditOverlayProps) {
  const trimmedItemId = useRollingEditPreviewStore((s) => s.trimmedItemId);
  const neighborItemId = useRollingEditPreviewStore((s) => s.neighborItemId);
  const handle = useRollingEditPreviewStore((s) => s.handle);
  const neighborDelta = useRollingEditPreviewStore((s) => s.neighborDelta);

  if (!trimmedItemId || !neighborItemId || !handle) return null;

  return (
    <RollingEditOverlayInner
      trimmedItemId={trimmedItemId}
      neighborItemId={neighborItemId}
      handle={handle}
      neighborDelta={neighborDelta}
      fps={fps}
    />
  );
}

interface InnerProps {
  trimmedItemId: string;
  neighborItemId: string;
  handle: 'start' | 'end';
  neighborDelta: number;
  fps: number;
}

function getItemAspectRatio(item: TimelineItem): number {
  if ((item.type === 'video' || item.type === 'image') && item.sourceWidth && item.sourceHeight) {
    return item.sourceWidth / item.sourceHeight;
  }
  return 16 / 9;
}

const TEXT_SPACE = 56; // px reserved for label + timecode rows
const GAP = 8; // px gap between panels

function RollingEditOverlayInner({
  trimmedItemId,
  neighborItemId,
  handle,
  neighborDelta,
  fps,
}: InnerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setContainerSize((prev) =>
        prev.width === width && prev.height === height ? prev : { width, height },
      );
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const items = useTimelineStore((s) => s.items);
  const itemsMap = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const trimmedItem = itemsMap.get(trimmedItemId);
  const neighborItem = itemsMap.get(neighborItemId);

  if (!trimmedItem || !neighborItem) return null;

  // Determine left (outgoing) and right (incoming) clips based on which handle is being dragged
  const leftItem = handle === 'end' ? trimmedItem : neighborItem;
  const rightItem = handle === 'end' ? neighborItem : trimmedItem;

  // Calculate the edit point frame on the timeline
  const editPointFrame =
    handle === 'end'
      ? leftItem.from + leftItem.durationInFrames + neighborDelta
      : rightItem.from + neighborDelta;

  // Local frames within each clip at the edit point
  const outLocalFrame = Math.max(0, editPointFrame - leftItem.from - 1);
  const inLocalFrame = Math.max(0, editPointFrame - rightItem.from);

  // Source time calculations
  const leftSourceFps = leftItem.sourceFps ?? fps;
  const leftRate = leftItem.speed ?? 1;
  const leftSourceStart = leftItem.sourceStart ?? 0;

  const rightSourceFps = rightItem.sourceFps ?? fps;
  const rightRate = rightItem.speed ?? 1;
  const rightSourceStart = rightItem.sourceStart ?? 0;

  const outSourceTime = getVideoTargetTimeSeconds(
    leftSourceStart, leftSourceFps, outLocalFrame, leftRate, fps, 0,
  );
  const inSourceTime = getVideoTargetTimeSeconds(
    rightSourceStart, rightSourceFps, inLocalFrame, rightRate, fps, 0,
  );

  const outSourceFrame = Math.max(0, Math.round(outSourceTime * leftSourceFps));
  const inSourceFrame = Math.max(0, Math.round(inSourceTime * rightSourceFps));

  const outTimecode = formatTimecode(outSourceFrame, leftSourceFps);
  const inTimecode = formatTimecode(inSourceFrame, rightSourceFps);

  // Compute shared video area: each video fills panel width, shared area uses the taller height
  const leftAR = getItemAspectRatio(leftItem);
  const rightAR = getItemAspectRatio(rightItem);
  const panelWidth = (containerSize.width - GAP) / 2;
  const maxAreaHeight = containerSize.height - TEXT_SPACE;

  // Each video at full panel width → natural height
  const leftNatural = panelWidth / leftAR;
  const rightNatural = panelWidth / rightAR;
  // Shared area = tallest video, capped to available space
  const sharedAreaHeight = Math.max(1, Math.min(Math.max(leftNatural, rightNatural), maxAreaHeight));

  return (
    <div ref={containerRef} className="absolute inset-0 z-30 bg-black flex items-center" style={{ gap: GAP }}>
      <FramePanel
        item={leftItem}
        sourceTime={outSourceTime}
        timecode={outTimecode}
        label="OUT"
        areaHeight={sharedAreaHeight}
        panelWidth={panelWidth}
      />
      <FramePanel
        item={rightItem}
        sourceTime={inSourceTime}
        timecode={inTimecode}
        label="IN"
        areaHeight={sharedAreaHeight}
        panelWidth={panelWidth}
      />
    </div>
  );
}

interface FramePanelProps {
  item: TimelineItem;
  sourceTime: number;
  timecode: string;
  label: string;
  areaHeight: number;
  panelWidth: number;
}

function FramePanel({ item, sourceTime, timecode, label, areaHeight, panelWidth }: FramePanelProps) {
  const isVideo = item.type === 'video';
  const isImage = item.type === 'image';
  const ar = getItemAspectRatio(item);

  // Video fills panel width; if that exceeds the shared area height, constrain by height instead
  let videoWidth = panelWidth;
  let videoHeight = panelWidth / ar;
  if (videoHeight > areaHeight) {
    videoHeight = areaHeight;
    videoWidth = areaHeight * ar;
  }

  return (
    <div className="flex-1 min-w-0 flex flex-col items-center justify-center">
      <span className="text-base font-semibold tracking-widest text-white/80 uppercase pb-1">
        {label}
      </span>
      {/* Shared-height area — video is centered, wider clips get letterboxing */}
      <div
        className="flex items-center justify-center shrink-0 bg-black"
        style={{ width: panelWidth, height: areaHeight }}
      >
        <div
          className="overflow-hidden border border-white/10"
          style={{ width: videoWidth, height: videoHeight }}
        >
          {isVideo ? (
            <VideoFrame item={item} sourceTime={sourceTime} />
          ) : isImage ? (
            <ImageFrame item={item} />
          ) : (
            <TypePlaceholder type={item.type} />
          )}
        </div>
      </div>
      <span className="text-lg font-mono text-white/90 tabular-nums pt-1">
        {timecode}
      </span>
    </div>
  );
}

// ── Video frame extraction via hidden <video> + <canvas> ─────────────────

interface VideoFrameProps {
  item: TimelineItem;
  sourceTime: number;
}

function VideoFrame({ item, sourceTime }: VideoFrameProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const seekingRef = useRef(false);
  const pendingTimeRef = useRef<number | null>(null);

  // Resolve blob URL for this media item
  useEffect(() => {
    let cancelled = false;
    if (!item.mediaId) return;

    resolveMediaUrl(item.mediaId).then((url) => {
      if (!cancelled && url) setBlobUrl(url);
    });
    return () => { cancelled = true; };
  }, [item.mediaId]);

  // Create hidden video element when blob URL is available
  useEffect(() => {
    if (!blobUrl) return;

    seekingRef.current = false;
    pendingTimeRef.current = null;

    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    video.src = blobUrl;
    videoRef.current = video;

    return () => {
      video.pause();
      video.removeAttribute('src');
      video.load();
      videoRef.current = null;
      seekingRef.current = false;
      pendingTimeRef.current = null;
    };
  }, [blobUrl]);

  const drawFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas to video dimensions for sharp rendering
    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth || 280;
      canvas.height = video.videoHeight || 158;
    }

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  }, []);

  // Seek video to source time whenever it changes
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !blobUrl) return;

    const targetTime = Math.max(0, sourceTime);

    const handleSeeked = () => {
      seekingRef.current = false;
      drawFrame();
      // If another seek was queued while we were seeking, do it now
      if (pendingTimeRef.current !== null) {
        const next = pendingTimeRef.current;
        pendingTimeRef.current = null;
        seekingRef.current = true;
        video.currentTime = next;
      }
    };

    video.addEventListener('seeked', handleSeeked);

    if (seekingRef.current) {
      // Queue this seek for when the current one finishes
      pendingTimeRef.current = targetTime;
    } else {
      seekingRef.current = true;
      video.currentTime = targetTime;
    }

    return () => {
      video.removeEventListener('seeked', handleSeeked);
    };
  }, [sourceTime, blobUrl, drawFrame]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full object-contain"
      style={{ imageRendering: 'auto' }}
    />
  );
}

// ── Image frame (draw image to canvas) ──────────────────────────────────

interface ImageFrameProps {
  item: TimelineItem;
}

function ImageFrame({ item }: ImageFrameProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!item.mediaId) return;

    resolveMediaUrl(item.mediaId).then((url) => {
      if (!cancelled && url) setBlobUrl(url);
    });
    return () => { cancelled = true; };
  }, [item.mediaId]);

  useEffect(() => {
    if (!blobUrl) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const img = new Image();
    img.onload = () => {
      canvas.width = img.naturalWidth || 280;
      canvas.height = img.naturalHeight || 158;
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    };
    img.src = blobUrl;

    return () => {
      img.onload = null;
    };
  }, [blobUrl]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full object-contain"
    />
  );
}

// ── Colored placeholder for non-visual clip types ───────────────────────

function TypePlaceholder({ type }: { type: string }) {
  const color = TYPE_PLACEHOLDER_COLORS[type] ?? '#6b7280';
  return (
    <div
      className="w-full h-full flex items-center justify-center"
      style={{ backgroundColor: color }}
    >
      <span className="text-sm font-medium text-white/90 uppercase tracking-wide">
        {type}
      </span>
    </div>
  );
}
