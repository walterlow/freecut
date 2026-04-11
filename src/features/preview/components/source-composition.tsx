import { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import {
  AbsoluteFill,
} from '@/features/preview/deps/player-core';
import {
  useClock,
  useClockIsPlaying,
  useClockPlaybackRate,
  useVideoConfig,
} from '@/features/preview/deps/player-context';
import {
  getGlobalVideoSourcePool,
} from '@/features/preview/deps/player-pool';
import {
  SharedVideoExtractorPool,
  type VideoFrameSource,
} from '@/features/preview/deps/export';
import { resolveProxyUrl } from '../utils/media-resolver';
import { usePlaybackStore } from '@/shared/state/playback';
import { useMediaLibraryStore } from '@/features/preview/deps/media-library';
import { FileAudio } from 'lucide-react';

interface SourceCompositionProps {
  mediaId?: string;
  src: string;
  mediaType: 'video' | 'audio' | 'image';
  fileName: string;
}

let sourceMonitorVideoInstanceCounter = 0;
let sourceMonitorStrictDecodeInstanceCounter = 0;
let globalSourceMonitorDecoderPool: SharedVideoExtractorPool | null = null;

const SOURCE_MONITOR_STRICT_DECODE_FALLBACK_FAILURES = 2;
const SOURCE_MONITOR_FRAME_CACHE_MAX = 90;
const SOURCE_MONITOR_CACHE_TIME_QUANTUM = 1 / 60;
const SOURCE_MONITOR_PLAYING_RESYNC_THRESHOLD_FRAMES = 6;

function getSourceMonitorDecoderPool(): SharedVideoExtractorPool {
  if (!globalSourceMonitorDecoderPool) {
    globalSourceMonitorDecoderPool = new SharedVideoExtractorPool();
  }
  return globalSourceMonitorDecoderPool;
}

function quantizeSourceMonitorTime(time: number): number {
  return Math.round(time / SOURCE_MONITOR_CACHE_TIME_QUANTUM) * SOURCE_MONITOR_CACHE_TIME_QUANTUM;
}

function shouldResyncPlayingMedia(currentTime: number, targetTime: number, fps: number): boolean {
  return Math.abs(currentTime - targetTime) * fps >= SOURCE_MONITOR_PLAYING_RESYNC_THRESHOLD_FRAMES;
}

function useSourceMonitorVideoSrc(mediaId: string | undefined, src: string): string {
  const useProxy = usePlaybackStore((s) => s.useProxy);
  const proxyStatus = useMediaLibraryStore((s) => (
    mediaId ? (s.proxyStatus.get(mediaId) ?? null) : null
  ));

  return useMemo(() => {
    if (!src) return '';
    if (useProxy && mediaId) {
      return resolveProxyUrl(mediaId) || src;
    }
    return src;
  }, [mediaId, proxyStatus, src, useProxy]);
}

export function SourceComposition({ mediaId, src, mediaType, fileName }: SourceCompositionProps) {
  if (mediaType === 'video') {
    return <VideoSource mediaId={mediaId} src={src} />;
  }
  if (mediaType === 'image') {
    return <ImageSource src={src} />;
  }
  return <AudioSource src={src} fileName={fileName} />;
}

function VideoSource({ mediaId, src }: { mediaId?: string; src: string }) {
  const activeSrc = useSourceMonitorVideoSrc(mediaId, src);
  const clock = useClock();
  const playing = useClockIsPlaying();
  const playbackRate = useClockPlaybackRate();
  const videoContainerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const poolRef = useRef(getGlobalVideoSourcePool());
  const poolClipIdRef = useRef<string>(`source-monitor-${++sourceMonitorVideoInstanceCounter}`);
  const decoderPoolRef = useRef(getSourceMonitorDecoderPool());
  const decodeLaneRef = useRef<string>(`source-monitor-strict-${++sourceMonitorStrictDecodeInstanceCounter}`);
  const extractorRef = useRef<VideoFrameSource | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const contextRef = useRef<CanvasRenderingContext2D | null>(null);
  const mountedRef = useRef(true);
  const decoderReadyRef = useRef(false);
  const renderInFlightRef = useRef(false);
  const pendingTimeRef = useRef<number | null>(null);
  const latestTargetTimeRef = useRef(0);
  const consecutiveDecodeFailuresRef = useRef(0);
  const frameCacheRef = useRef<Map<number, ImageBitmap>>(new Map());
  const frameCacheOrderRef = useRef<number[]>([]);
  const { fps } = useVideoConfig();
  const lastFrameRef = useRef(clock.currentFrame);
  const playingRef = useRef(playing);
  const decoderItemId = `${mediaId ?? 'source-monitor'}:${decodeLaneRef.current}`;
  const [useLegacyPausedSeek, setUseLegacyPausedSeek] = useState(false);
  const [strictDecodeReady, setStrictDecodeReady] = useState(false);
  const [hasDecodedFrame, setHasDecodedFrame] = useState(false);

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      for (const bitmap of frameCacheRef.current.values()) {
        bitmap.close();
      }
      frameCacheRef.current.clear();
      frameCacheOrderRef.current = [];
    };
  }, []);

  useEffect(() => {
    setUseLegacyPausedSeek(false);
    setHasDecodedFrame(false);
  }, [activeSrc, mediaId]);

  const drawDecodedFrame = useCallback(async (targetTime: number) => {
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
    const targetWidth = Math.max(1, Math.round(decodedWidth || 640));
    const targetHeight = Math.max(1, Math.round(decodedHeight || 360));

    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
    }

    const cacheKey = quantizeSourceMonitorTime(targetTime);
    const cache = frameCacheRef.current;
    const cacheOrder = frameCacheOrderRef.current;
    const cached = cache.get(cacheKey);
    if (cached) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(cached, 0, 0, canvas.width, canvas.height);
      const cacheIndex = cacheOrder.indexOf(cacheKey);
      if (cacheIndex !== -1) {
        cacheOrder.splice(cacheIndex, 1);
        cacheOrder.push(cacheKey);
      }
      return true;
    }

    const didDraw = await extractor.drawFrame(
      ctx,
      Math.max(0, targetTime),
      0,
      0,
      canvas.width,
      canvas.height,
    );
    if (!didDraw) return false;

    try {
      const bitmap = await createImageBitmap(canvas);
      cache.set(cacheKey, bitmap);
      cacheOrder.push(cacheKey);
      while (cacheOrder.length > SOURCE_MONITOR_FRAME_CACHE_MAX) {
        const evictKey = cacheOrder.shift();
        if (evictKey === undefined) break;
        const evicted = cache.get(evictKey);
        if (!evicted) continue;
        evicted.close();
        cache.delete(evictKey);
      }
    } catch {
      // Cache population is best-effort only.
    }

    return true;
  }, []);

  const pumpLatestDecodedFrame = useCallback(() => {
    if (renderInFlightRef.current) return;
    renderInFlightRef.current = true;

    const run = async () => {
      try {
        while (
          decoderReadyRef.current
          && pendingTimeRef.current !== null
          && mountedRef.current
          && !playingRef.current
        ) {
          const targetTime = pendingTimeRef.current;
          pendingTimeRef.current = null;

          const didDraw = await drawDecodedFrame(targetTime).catch(() => false);
          if (didDraw) {
            consecutiveDecodeFailuresRef.current = 0;
            setHasDecodedFrame(true);
            continue;
          }

          const failureKind = extractorRef.current?.getLastFailureKind() ?? 'decode-error';
          if (failureKind === 'decode-error') {
            consecutiveDecodeFailuresRef.current += 1;
            if (consecutiveDecodeFailuresRef.current >= SOURCE_MONITOR_STRICT_DECODE_FALLBACK_FAILURES) {
              decoderReadyRef.current = false;
              setStrictDecodeReady(false);
              setUseLegacyPausedSeek((prev) => (prev ? prev : true));
              return;
            }
          }
        }
      } finally {
        renderInFlightRef.current = false;
        if (
          decoderReadyRef.current
          && pendingTimeRef.current !== null
          && mountedRef.current
          && !playingRef.current
        ) {
          queueMicrotask(() => {
            if (!mountedRef.current) return;
            pumpLatestDecodedFrame();
          });
        }
      }
    };

    void run();
  }, [drawDecodedFrame]);

  // Acquire/release pooled element when source changes.
  useEffect(() => {
    if (!activeSrc) return;

    const pool = poolRef.current;
    const clipId = poolClipIdRef.current;

    pool.preloadSource(activeSrc).catch(() => {});
    const video = pool.acquireForClip(clipId, activeSrc);
    if (!video) return;

    video.muted = true;
    video.volume = 0;
    video.playsInline = true;
    video.style.width = '100%';
    video.style.height = '100%';
    video.style.objectFit = 'contain';
    video.style.display = 'block';
    video.style.position = 'absolute';
    video.style.top = '0';
    video.style.left = '0';

    const container = videoContainerRef.current;
    if (container && video.parentElement !== container) {
      container.appendChild(video);
    }

    videoRef.current = video;

    return () => {
      video.pause();
      if (video.parentElement) {
        video.parentElement.removeChild(video);
      }
      pool.releaseClip(clipId);
      videoRef.current = null;
    };
  }, [activeSrc]);

  useEffect(() => {
    decoderReadyRef.current = false;
    setStrictDecodeReady(false);
    setHasDecodedFrame(false);
    extractorRef.current = null;
    pendingTimeRef.current = null;
    consecutiveDecodeFailuresRef.current = 0;
    contextRef.current = null;

    for (const bitmap of frameCacheRef.current.values()) {
      bitmap.close();
    }
    frameCacheRef.current.clear();
    frameCacheOrderRef.current = [];

    if (!activeSrc) return;

    const pool = decoderPoolRef.current;
    const extractor = pool.getOrCreateItemExtractor(decoderItemId, activeSrc);
    extractorRef.current = extractor;

    let cancelled = false;
    void extractor.init()
      .then((ready) => {
        if (cancelled || !mountedRef.current) return;
        if (!ready) {
          setUseLegacyPausedSeek((prev) => (prev ? prev : true));
          return;
        }
        decoderReadyRef.current = true;
        setStrictDecodeReady(true);
        pendingTimeRef.current = latestTargetTimeRef.current;
        if (!playingRef.current) {
          pumpLatestDecodedFrame();
        }
      })
      .catch(() => {
        if (cancelled || !mountedRef.current) return;
        setUseLegacyPausedSeek((prev) => (prev ? prev : true));
      });

    return () => {
      cancelled = true;
      decoderReadyRef.current = false;
      setStrictDecodeReady(false);
      extractorRef.current = null;
      pendingTimeRef.current = null;
      pool.releaseItem(decoderItemId);
    };
  }, [activeSrc, decoderItemId, pumpLatestDecodedFrame]);

  const syncSourceFrame = useCallback((frame: number) => {
    const video = videoRef.current;
    const audio = audioRef.current;
    const targetTime = frame / fps;
    latestTargetTimeRef.current = targetTime;

    lastFrameRef.current = frame;

    if (!playingRef.current && !useLegacyPausedSeek) {
      pendingTimeRef.current = targetTime;
      if (decoderReadyRef.current) {
        pumpLatestDecodedFrame();
      }
    }

    const syncAudioTime = () => {
      if (!audio || !src || audio.readyState < 1) {
        return;
      }

      if (playingRef.current) {
        if (!shouldResyncPlayingMedia(audio.currentTime, targetTime, fps)) {
          return;
        }
      }

      try {
        audio.currentTime = targetTime;
      } catch {
        // Ignore seek errors while media is loading
      }
    };

    if (!video || !activeSrc) {
      syncAudioTime();
      return;
    }

    const canSeek = video.readyState >= 1;
    if (!canSeek) return;

    if (!playingRef.current && strictDecodeReady && hasDecodedFrame && !useLegacyPausedSeek) {
      syncAudioTime();
      return;
    }

    if (playingRef.current) {
      if (!shouldResyncPlayingMedia(video.currentTime, targetTime, fps)) {
        syncAudioTime();
        return;
      }
      try {
        video.currentTime = targetTime;
      } catch {
        // Ignore seek errors while media is loading
      }
      syncAudioTime();
      return;
    }

    try {
      poolRef.current.seekClip(poolClipIdRef.current, frame / fps, { fast: true });
    } catch {
      // Ignore seek errors while media is loading
    }

    syncAudioTime();
  }, [activeSrc, fps, hasDecodedFrame, pumpLatestDecodedFrame, src, strictDecodeReady, useLegacyPausedSeek]);

  useEffect(() => {
    syncSourceFrame(clock.currentFrame);
    return clock.onFrameChange((frame) => {
      syncSourceFrame(frame);
    });
  }, [clock, syncSourceFrame]);

  useEffect(() => {
    syncSourceFrame(clock.currentFrame);
  }, [clock, playing, syncSourceFrame]);

  // Handle play/pause sync
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !activeSrc) return;

    if (playing) {
      video.playbackRate = playbackRate;
      if (video.readyState >= 1) {
        try {
          video.currentTime = latestTargetTimeRef.current;
        } catch {
          // Ignore seek errors while media is loading
        }
      }
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, [activeSrc, playbackRate, playing]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !src) return;

    if (playing) {
      audio.playbackRate = playbackRate;
      if (audio.readyState >= 1) {
        try {
          audio.currentTime = latestTargetTimeRef.current;
        } catch {
          // Ignore seek errors while media is loading
        }
      }
      audio.play().catch(() => {});
    } else {
      audio.pause();
    }
  }, [playbackRate, playing, src]);

  const showDecodedCanvas = !playing && strictDecodeReady && hasDecodedFrame && !useLegacyPausedSeek;

  return (
    <AbsoluteFill>
      <div
        ref={videoContainerRef}
        style={{
          width: '100%',
          height: '100%',
          position: 'relative',
          display: showDecodedCanvas ? 'none' : 'block',
        }}
      />
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height: '100%',
          display: showDecodedCanvas ? 'block' : 'none',
        }}
      />
      <audio ref={audioRef} src={src} preload="auto" style={{ display: 'none' }} />
    </AbsoluteFill>
  );
}

function ImageSource({ src }: { src: string }) {
  return (
    <AbsoluteFill>
      <img
        src={src}
        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        alt="Source preview"
      />
    </AbsoluteFill>
  );
}

function AudioSource({ src, fileName }: { src: string; fileName: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const clock = useClock();
  const playing = useClockIsPlaying();
  const playbackRate = useClockPlaybackRate();
  const { fps } = useVideoConfig();
  const lastFrameRef = useRef(clock.currentFrame);

  const syncAudioFrame = useCallback((frame: number) => {
    const audio = audioRef.current;
    if (!audio || !src) return;

    const targetTime = frame / fps;
    lastFrameRef.current = frame;

    const canSeek = audio.readyState >= 1;
    if (!canSeek) {
      return;
    }

    if (playing && !shouldResyncPlayingMedia(audio.currentTime, targetTime, fps)) {
      return;
    }

    try {
      audio.currentTime = targetTime;
    } catch {
      // Ignore seek errors while media is loading
    }
  }, [fps, playing, src]);

  useEffect(() => {
    syncAudioFrame(clock.currentFrame);
    return clock.onFrameChange((frame) => {
      syncAudioFrame(frame);
    });
  }, [clock, syncAudioFrame]);

  useEffect(() => {
    syncAudioFrame(clock.currentFrame);
  }, [clock, playing, syncAudioFrame]);

  // Handle play/pause
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !src) return;

    if (playing) {
      audio.playbackRate = playbackRate;
      if (audio.readyState >= 1) {
        try {
          audio.currentTime = lastFrameRef.current / fps;
        } catch {
          // Ignore seek errors while media is loading
        }
      }
      audio.play().catch(() => {});
    } else {
      audio.pause();
    }
  }, [playing, playbackRate, src, fps]);

  return (
    <AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#1a1a2e' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
        <FileAudio style={{ width: 48, height: 48, color: '#22c55e' }} />
        <span style={{ color: '#a1a1aa', fontSize: 14, maxWidth: 200, textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {fileName}
        </span>
      </div>
      <audio ref={audioRef} src={src} preload="auto" />
    </AbsoluteFill>
  );
}
