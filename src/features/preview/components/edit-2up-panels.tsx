import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  SharedVideoExtractorPool,
  type VideoFrameSource,
} from '@/features/export/utils/shared-video-extractor';
import { getGlobalVideoSourcePool } from '@/features/player/video/VideoSourcePool';
import type { TimelineItem } from '@/types/timeline';
import { usePlaybackStore } from '../stores/playback-store';
import { resolveMediaUrl, resolveProxyUrl } from '../utils/media-resolver';
import {
  computeFittedMediaSize,
  getItemAspectRatio,
  renderPanelMedia,
} from './edit-panel-media-utils';

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
const FALLBACK_CANVAS_WIDTH = 280;
const FALLBACK_CANVAS_HEIGHT = 158;
const STRICT_DECODE_FALLBACK_FAILURES = 2;
let previewVideoInstanceCounter = 0;
let strictDecodeInstanceCounter = 0;
let globalEditOverlayDecoderPool: SharedVideoExtractorPool | null = null;

function getEditOverlayDecoderPool(): SharedVideoExtractorPool {
  if (!globalEditOverlayDecoderPool) {
    globalEditOverlayDecoderPool = new SharedVideoExtractorPool();
  }
  return globalEditOverlayDecoderPool;
}

function useResolvedVideoBlobUrl(mediaId: string | undefined, useProxy: boolean): string | null {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setBlobUrl(null);

    if (!mediaId) {
      return () => {
        cancelled = true;
      };
    }

    if (useProxy) {
      const proxyUrl = resolveProxyUrl(mediaId);
      if (proxyUrl) {
        setBlobUrl(proxyUrl);
        return () => {
          cancelled = true;
        };
      }
    }

    resolveMediaUrl(mediaId)
      .then((url) => {
        if (cancelled) return;
        setBlobUrl(url || null);
      })
      .catch(() => {
        if (cancelled) return;
        setBlobUrl(null);
      });

    return () => {
      cancelled = true;
    };
  }, [mediaId, useProxy]);

  return blobUrl;
}

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

  const panelWidth = Math.max((containerSize.width - GAP) / 2, 1);
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
  const { mediaWidth, mediaHeight } = computeFittedMediaSize(panelWidth, areaHeight, ar);

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
          {renderPanelMedia(item, sourceTime, placeholderText, {
            renderVideo: (videoItem, time) => <VideoFrame item={videoItem} sourceTime={time} />,
            renderImage: (imageItem) => <ImageFrame item={imageItem} />,
            renderPlaceholder: (type, text) => <TypePlaceholder type={type} text={text} />,
          })}
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

function VideoFrameImpl({ item, sourceTime }: VideoFrameProps) {
  const [useLegacyFallback, setUseLegacyFallback] = useState(false);

  useEffect(() => {
    setUseLegacyFallback(false);
  }, [item.id, item.mediaId]);

  const handleStrictDecodeFailure = useCallback(() => {
    setUseLegacyFallback((prev) => (prev ? prev : true));
  }, []);

  if (useLegacyFallback) {
    return <LegacySeekVideoFrame item={item} sourceTime={sourceTime} />;
  }

  return (
    <StrictDecodedVideoFrame
      item={item}
      sourceTime={sourceTime}
      onDecodeFailure={handleStrictDecodeFailure}
    />
  );
}

interface StrictDecodedVideoFrameProps extends VideoFrameProps {
  onDecodeFailure: () => void;
}

function StrictDecodedVideoFrame({
  item,
  sourceTime,
  onDecodeFailure,
}: StrictDecodedVideoFrameProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const decoderPoolRef = useRef(getEditOverlayDecoderPool());
  const decodeLaneRef = useRef<string>(`edit-preview-strict-${++strictDecodeInstanceCounter}`);
  const extractorRef = useRef<VideoFrameSource | null>(null);
  const mountedRef = useRef(true);
  const decoderReadyRef = useRef(false);
  const renderInFlightRef = useRef(false);
  const pendingTimeRef = useRef<number | null>(null);
  const consecutiveDecodeFailuresRef = useRef(0);
  const latestTargetTimeRef = useRef(Math.max(0, sourceTime));
  const useProxy = usePlaybackStore((s) => s.useProxy);
  const blobUrl = useResolvedVideoBlobUrl(item.mediaId, useProxy);
  const contextRef = useRef<CanvasRenderingContext2D | null>(null);
  const decoderItemId = `${item.id}:${decodeLaneRef.current}`;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const drawFrame = useCallback(async (targetTime: number) => {
    const extractor = extractorRef.current;
    const canvas = canvasRef.current;
    if (!extractor || !canvas) return false;

    let ctx = contextRef.current;
    if (!ctx) {
      ctx = canvas.getContext('2d');
      if (!ctx) return false;
      contextRef.current = ctx;
    }

    const { width: decodedWidth, height: decodedHeight } = extractor.getDimensions();
    const targetWidth = Math.max(1, Math.round(decodedWidth || FALLBACK_CANVAS_WIDTH));
    const targetHeight = Math.max(1, Math.round(decodedHeight || FALLBACK_CANVAS_HEIGHT));

    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
    }

    return extractor.drawFrame(ctx, Math.max(0, targetTime), 0, 0, canvas.width, canvas.height);
  }, []);

  const pumpLatestFrame = useCallback(() => {
    if (renderInFlightRef.current) return;
    renderInFlightRef.current = true;

    const run = async () => {
      try {
        while (decoderReadyRef.current && pendingTimeRef.current !== null && mountedRef.current) {
          const targetTime = pendingTimeRef.current;
          pendingTimeRef.current = null;

          const didDraw = await drawFrame(targetTime).catch(() => false);
          if (didDraw) {
            consecutiveDecodeFailuresRef.current = 0;
            continue;
          }

          const failureKind = extractorRef.current?.getLastFailureKind() ?? 'decode-error';
          if (failureKind === 'decode-error') {
            consecutiveDecodeFailuresRef.current += 1;
            if (consecutiveDecodeFailuresRef.current >= STRICT_DECODE_FALLBACK_FAILURES) {
              onDecodeFailure();
              return;
            }
          }
        }
      } finally {
        renderInFlightRef.current = false;
        if (decoderReadyRef.current && pendingTimeRef.current !== null && mountedRef.current) {
          queueMicrotask(() => {
            if (!mountedRef.current) return;
            pumpLatestFrame();
          });
        }
      }
    };

    void run();
  }, [drawFrame, onDecodeFailure]);

  useEffect(() => {
    decoderReadyRef.current = false;
    extractorRef.current = null;
    pendingTimeRef.current = null;
    consecutiveDecodeFailuresRef.current = 0;
    contextRef.current = null;

    if (!blobUrl) return;

    const pool = decoderPoolRef.current;
    const extractor = pool.getOrCreateItemExtractor(decoderItemId, blobUrl);
    extractorRef.current = extractor;

    let cancelled = false;
    void extractor
      .init()
      .then((ready) => {
        if (cancelled || !mountedRef.current) return;
        if (!ready) {
          onDecodeFailure();
          return;
        }
        decoderReadyRef.current = true;
        pendingTimeRef.current = latestTargetTimeRef.current;
        pumpLatestFrame();
      })
      .catch(() => {
        if (cancelled || !mountedRef.current) return;
        onDecodeFailure();
      });

    return () => {
      cancelled = true;
      decoderReadyRef.current = false;
      extractorRef.current = null;
      pendingTimeRef.current = null;
      pool.releaseItem(decoderItemId);
    };
  }, [blobUrl, decoderItemId, onDecodeFailure, pumpLatestFrame]);

  useEffect(() => {
    latestTargetTimeRef.current = Math.max(0, sourceTime);
    pendingTimeRef.current = latestTargetTimeRef.current;
    if (decoderReadyRef.current) {
      pumpLatestFrame();
    }
  }, [sourceTime, pumpLatestFrame]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full object-contain"
      style={{ imageRendering: 'auto' }}
    />
  );
}

function LegacySeekVideoFrame({ item, sourceTime }: VideoFrameProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const poolRef = useRef(getGlobalVideoSourcePool());
  const poolClipIdRef = useRef<string>(`edit-preview-${++previewVideoInstanceCounter}`);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const useProxy = usePlaybackStore((s) => s.useProxy);
  const blobUrl = useResolvedVideoBlobUrl(item.mediaId, useProxy);
  const contextRef = useRef<CanvasRenderingContext2D | null>(null);
  const seekingRef = useRef(false);
  const pendingTimeRef = useRef<number | null>(null);
  const latestTargetTimeRef = useRef(0);

  const drawFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) return;

    let ctx = contextRef.current;
    if (!ctx) {
      ctx = canvas.getContext('2d');
      if (!ctx) return;
      contextRef.current = ctx;
    }

    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth || FALLBACK_CANVAS_WIDTH;
      canvas.height = video.videoHeight || FALLBACK_CANVAS_HEIGHT;
    }

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  }, []);

  const requestSeek = useCallback((targetTime: number) => {
    const video = videoRef.current;
    if (!video) return;

    const tolerance = 0.001;
    if (seekingRef.current) {
      pendingTimeRef.current = targetTime;
      return;
    }

    if (Math.abs(video.currentTime - targetTime) < tolerance) {
      drawFrame();
      return;
    }

    seekingRef.current = true;
    video.currentTime = targetTime;
  }, [drawFrame]);

  useEffect(() => {
    if (!blobUrl) return;

    const pool = poolRef.current;
    const clipId = poolClipIdRef.current;
    seekingRef.current = false;
    pendingTimeRef.current = null;

    pool.preloadSource(blobUrl).catch(() => {});

    const video = pool.acquireForClip(clipId, blobUrl);
    if (!video) return;

    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    videoRef.current = video;

    const handleSeeked = () => {
      seekingRef.current = false;
      drawFrame();

      if (pendingTimeRef.current !== null) {
        const next = pendingTimeRef.current;
        pendingTimeRef.current = null;
        requestSeek(next);
      }
    };

    // Fallback for seeking to time 0 on a new video: currentTime is already 0,
    // so browsers may not dispatch "seeked". Draw once data is available.
    const handleLoadedData = () => {
      if (Math.abs(video.currentTime - latestTargetTimeRef.current) < 0.001) {
        drawFrame();
      }
    };

    video.addEventListener('seeked', handleSeeked);
    video.addEventListener('loadeddata', handleLoadedData);

    return () => {
      video.removeEventListener('seeked', handleSeeked);
      video.removeEventListener('loadeddata', handleLoadedData);
      video.pause();
      videoRef.current = null;
      seekingRef.current = false;
      pendingTimeRef.current = null;
      pool.releaseClip(clipId);
    };
  }, [blobUrl, drawFrame, requestSeek]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !blobUrl) return;

    const targetTime = Math.max(0, sourceTime);
    latestTargetTimeRef.current = targetTime;
    requestSeek(targetTime);
  }, [sourceTime, blobUrl, requestSeek]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full object-contain"
      style={{ imageRendering: 'auto' }}
    />
  );
}

const areVideoFramePropsEqual = (prev: VideoFrameProps, next: VideoFrameProps) => (
  prev.sourceTime === next.sourceTime
  && prev.item.id === next.item.id
  && prev.item.mediaId === next.item.mediaId
);

export const VideoFrame = memo(VideoFrameImpl, areVideoFramePropsEqual);

interface ImageFrameProps {
  item: TimelineItem;
}

function ImageFrameImpl({ item }: ImageFrameProps) {
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

const areImageFramePropsEqual = (prev: ImageFrameProps, next: ImageFrameProps) => (
  prev.item.id === next.item.id
  && prev.item.mediaId === next.item.mediaId
);

export const ImageFrame = memo(ImageFrameImpl, areImageFramePropsEqual);

export function TypePlaceholder({ type, text }: { type: string; text: string }) {
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
