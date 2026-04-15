import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  SharedVideoExtractorPool,
  type VideoFrameSource,
} from '@/features/preview/deps/export';
import type { TimelineItem } from '@/types/timeline';
import { usePlaybackStore } from '@/shared/state/playback';
import { resolveMediaUrl, resolveProxyUrl } from '../utils/media-resolver';
import {
  computeFittedMediaSize,
  getItemAspectRatio,
  renderPanelMedia,
} from './edit-panel-media-utils';
import { useBlobUrlVersion } from '@/infrastructure/browser/blob-url-manager';

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
/** Frame cache for edit overlay panels — instant revisits during drag reversal */
const EDIT_PANEL_CACHE_MAX = 60;
/** Quantize source time to ~frame-level resolution for cache keys */
const CACHE_TIME_QUANTUM = 1 / 60;
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
  const blobUrlVersion = useBlobUrlVersion();
  const requestKeyRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const requestKey = `${mediaId ?? 'none'}:${useProxy ? 'proxy' : 'source'}`;
    if (requestKeyRef.current !== requestKey) {
      requestKeyRef.current = requestKey;
      setBlobUrl(null);
    }

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
  }, [mediaId, useProxy, blobUrlVersion]);

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
  const [decodeFailed, setDecodeFailed] = useState(false);

  useEffect(() => {
    setDecodeFailed(false);
  }, [item.id, item.mediaId]);

  const handleStrictDecodeFailure = useCallback(() => {
    setDecodeFailed((prev) => (prev ? prev : true));
  }, []);

  if (decodeFailed) {
    return <TypePlaceholder type="video" text="Preview unavailable" />;
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

function quantizeTime(t: number): number {
  return Math.round(t / CACHE_TIME_QUANTUM) * CACHE_TIME_QUANTUM;
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
  // Frame cache: quantized source time → ImageBitmap for instant revisits
  const frameCacheRef = useRef<Map<number, ImageBitmap>>(new Map());
  const frameCacheOrderRef = useRef<number[]>([]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Clean up cached bitmaps on unmount
      for (const bitmap of frameCacheRef.current.values()) {
        bitmap.close();
      }
      frameCacheRef.current.clear();
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

    // Check frame cache first
    const cacheKey = quantizeTime(targetTime);
    const cache = frameCacheRef.current;
    const cacheOrder = frameCacheOrderRef.current;
    const cached = cache.get(cacheKey);
    if (cached) {
      ctx.drawImage(cached, 0, 0, canvas.width, canvas.height);
      // Move to end of LRU order
      const idx = cacheOrder.indexOf(cacheKey);
      if (idx !== -1) {
        cacheOrder.splice(idx, 1);
        cacheOrder.push(cacheKey);
      }
      return true;
    }

    const didDraw = await extractor.drawFrame(ctx, Math.max(0, targetTime), 0, 0, canvas.width, canvas.height);
    if (!didDraw) return false;

    // Cache the decoded frame as ImageBitmap
    try {
      const bitmap = await createImageBitmap(canvas);
      cache.set(cacheKey, bitmap);
      cacheOrder.push(cacheKey);
      // LRU eviction
      while (cacheOrder.length > EDIT_PANEL_CACHE_MAX) {
        const evictKey = cacheOrder.shift()!;
        const evicted = cache.get(evictKey);
        if (evicted) {
          evicted.close();
          cache.delete(evictKey);
        }
      }
    } catch {
      // createImageBitmap can fail on empty canvas — not critical
    }

    return true;
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
    // Clear frame cache on source change
    for (const bitmap of frameCacheRef.current.values()) {
      bitmap.close();
    }
    frameCacheRef.current.clear();
    frameCacheOrderRef.current.length = 0;

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
