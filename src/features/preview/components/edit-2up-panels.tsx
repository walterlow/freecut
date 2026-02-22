import { useEffect, useRef, useCallback, useState } from 'react';
import type { TimelineItem } from '@/types/timeline';
import { resolveMediaUrl } from '../utils/media-resolver';

const TYPE_PLACEHOLDER_COLORS: Record<string, string> = {
  image: '#22c55e',
  text: '#f59e0b',
  shape: '#8b5cf6',
  adjustment: '#6b7280',
  composition: '#3b82f6',
  audio: '#ec4899',
  gap: '#111827',
};

const TEXT_SPACE = 56;
const GAP = 8;

export interface EditTwoUpPanelData {
  item: TimelineItem | null;
  sourceTime?: number;
  timecode: string;
  label: string;
  placeholderText?: string;
}

interface EditTwoUpPanelsProps {
  leftPanel: EditTwoUpPanelData;
  rightPanel: EditTwoUpPanelData;
}

function getItemAspectRatio(item: TimelineItem | null): number {
  if (item && (item.type === 'video' || item.type === 'image') && item.sourceWidth && item.sourceHeight) {
    return item.sourceWidth / item.sourceHeight;
  }
  return 16 / 9;
}

export function EditTwoUpPanels({ leftPanel, rightPanel }: EditTwoUpPanelsProps) {
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

  const panelWidth = (containerSize.width - GAP) / 2;
  const maxAreaHeight = containerSize.height - TEXT_SPACE;

  const leftNatural = panelWidth / getItemAspectRatio(leftPanel.item);
  const rightNatural = panelWidth / getItemAspectRatio(rightPanel.item);
  const sharedAreaHeight = Math.max(1, Math.min(Math.max(leftNatural, rightNatural), maxAreaHeight));

  return (
    <div ref={containerRef} className="absolute inset-0 z-30 bg-black flex items-center" style={{ gap: GAP }}>
      <FramePanel
        item={leftPanel.item}
        sourceTime={leftPanel.sourceTime}
        timecode={leftPanel.timecode}
        label={leftPanel.label}
        areaHeight={sharedAreaHeight}
        panelWidth={panelWidth}
        placeholderText={leftPanel.placeholderText}
      />
      <FramePanel
        item={rightPanel.item}
        sourceTime={rightPanel.sourceTime}
        timecode={rightPanel.timecode}
        label={rightPanel.label}
        areaHeight={sharedAreaHeight}
        panelWidth={panelWidth}
        placeholderText={rightPanel.placeholderText}
      />
    </div>
  );
}

interface FramePanelProps {
  item: TimelineItem | null;
  sourceTime?: number;
  timecode: string;
  label: string;
  areaHeight: number;
  panelWidth: number;
  placeholderText?: string;
}

function FramePanel({
  item,
  sourceTime,
  timecode,
  label,
  areaHeight,
  panelWidth,
  placeholderText,
}: FramePanelProps) {
  const ar = getItemAspectRatio(item);

  let mediaWidth = panelWidth;
  let mediaHeight = panelWidth / ar;
  if (mediaHeight > areaHeight) {
    mediaHeight = areaHeight;
    mediaWidth = areaHeight * ar;
  }

  const isVideo = item?.type === 'video';
  const isImage = item?.type === 'image';

  return (
    <div className="flex-1 min-w-0 flex flex-col items-center justify-center">
      <span className="text-base font-semibold tracking-widest text-white/80 uppercase pb-1">
        {label}
      </span>
      <div
        className="flex items-center justify-center shrink-0 bg-black"
        style={{ width: panelWidth, height: areaHeight }}
      >
        <div
          className="overflow-hidden border border-white/10"
          style={{ width: mediaWidth, height: mediaHeight }}
        >
          {!item ? (
            <TypePlaceholder type="gap" text={placeholderText ?? 'GAP'} />
          ) : isVideo ? (
            <VideoFrame item={item} sourceTime={sourceTime ?? 0} />
          ) : isImage ? (
            <ImageFrame item={item} />
          ) : (
            <TypePlaceholder type={item.type} text={placeholderText ?? item.type} />
          )}
        </div>
      </div>
      <span className="text-lg font-mono text-white/90 tabular-nums pt-1">
        {timecode}
      </span>
    </div>
  );
}

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

  useEffect(() => {
    let cancelled = false;
    if (!item.mediaId) return;

    resolveMediaUrl(item.mediaId).then((url) => {
      if (!cancelled && url) setBlobUrl(url);
    });

    return () => {
      cancelled = true;
    };
  }, [item.mediaId]);

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

    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth || 280;
      canvas.height = video.videoHeight || 158;
    }

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !blobUrl) return;

    const targetTime = Math.max(0, sourceTime);

    const handleSeeked = () => {
      seekingRef.current = false;
      drawFrame();
      if (pendingTimeRef.current !== null) {
        const next = pendingTimeRef.current;
        pendingTimeRef.current = null;
        seekingRef.current = true;
        video.currentTime = next;
      }
    };

    // Fallback for seeking to time 0 on a new video: currentTime is already 0
    // so the browser won't fire 'seeked'. Draw once data is available instead.
    const handleLoadedData = () => {
      if (video.currentTime === targetTime) {
        drawFrame();
      }
    };

    video.addEventListener('seeked', handleSeeked);
    video.addEventListener('loadeddata', handleLoadedData);

    if (seekingRef.current) {
      pendingTimeRef.current = targetTime;
    } else {
      seekingRef.current = true;
      video.currentTime = targetTime;
    }

    return () => {
      video.removeEventListener('seeked', handleSeeked);
      video.removeEventListener('loadeddata', handleLoadedData);
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

    return () => {
      cancelled = true;
    };
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

function TypePlaceholder({ type, text }: { type: string; text: string }) {
  const color = TYPE_PLACEHOLDER_COLORS[type] ?? '#6b7280';
  return (
    <div
      className="w-full h-full flex items-center justify-center"
      style={{ backgroundColor: color }}
    >
      <span className="text-sm font-medium text-white/90 uppercase tracking-wide">
        {text}
      </span>
    </div>
  );
}
