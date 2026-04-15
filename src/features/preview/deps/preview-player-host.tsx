import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';
import { PlayerEmitterProvider, usePlayer, useBridgedTimelineContext, ClockBridgeProvider, VideoConfigProvider } from './player-context';
import { usePlayerEmitter } from '@/features/player/event-emitter';
import type { PlayerRef } from './player-contract';

interface PreviewPlayerHostProps {
  children: React.ReactNode;
  durationInFrames: number;
  fps: number;
  initialFrame?: number;
  loop?: boolean;
  autoPlay?: boolean;
  playbackRate?: number;
  style?: React.CSSProperties;
  width?: number;
  height?: number;
  onEnded?: () => void;
  onFrameChange?: (frame: number) => void;
  onPlayStateChange?: (isPlaying: boolean) => void;
}

const PreviewPlayerHostInner = forwardRef<PlayerRef, PreviewPlayerHostProps>(function PreviewPlayerHostInner(
  {
    children,
    durationInFrames,
    initialFrame = 0,
    loop = false,
    autoPlay = false,
    style,
    width = 1280,
    height = 720,
    onEnded,
    onFrameChange,
    onPlayStateChange,
  },
  ref,
) {
  const player = usePlayer(durationInFrames, { loop, onEnded });
  const { frame: currentFrame, playing } = useBridgedTimelineContext();
  const emitter = usePlayerEmitter();
  const containerRef = useRef<HTMLDivElement>(null);
  const contentHostRef = useRef<HTMLDivElement>(null);
  const contentScaleRef = useRef<HTMLDivElement>(null);

  const updateScaledLayout = useCallback(() => {
    const container = containerRef.current;
    const contentHost = contentHostRef.current;
    const contentScale = contentScaleRef.current;
    if (!container || !contentHost || !contentScale) return;

    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;
    const scale = containerWidth > 0 && containerHeight > 0
      ? Math.min(containerWidth / width, containerHeight / height)
      : 1;

    const scaledWidth = width * scale;
    const scaledHeight = height * scale;

    contentHost.style.width = `${scaledWidth}px`;
    contentHost.style.height = `${scaledHeight}px`;
    contentHost.style.marginLeft = `${-scaledWidth / 2}px`;
    contentHost.style.marginTop = `${-scaledHeight / 2}px`;

    contentScale.style.width = `${width}px`;
    contentScale.style.height = `${height}px`;
    contentScale.style.transform = `scale(${scale})`;
  }, [height, width]);

  useEffect(() => {
    if (initialFrame > 0 && currentFrame === 0) {
      player.seek(initialFrame);
    }
  }, [currentFrame, initialFrame, player]);

  useEffect(() => {
    if (autoPlay && !playing) {
      player.play();
    }
  }, [autoPlay, playing, player]);

  useEffect(() => {
    onFrameChange?.(currentFrame);
  }, [currentFrame, onFrameChange]);

  useEffect(() => {
    onPlayStateChange?.(playing);
  }, [onPlayStateChange, playing]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let rafId: number | null = null;
    const scheduleUpdate = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        updateScaledLayout();
      });
    };

    const observer = new ResizeObserver(scheduleUpdate);
    observer.observe(container);
    updateScaledLayout();

    return () => {
      observer.disconnect();
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
    };
  }, [updateScaledLayout]);

  useImperativeHandle(
    ref,
    () => ({
      play: () => player.play(),
      pause: () => player.pause(),
      toggle: () => player.toggle(),
      seekTo: (frame: number) => player.seek(frame),
      getCurrentFrame: () => player.getCurrentFrame(),
      isPlaying: () => player.isPlaying(),
      addEventListener: (event, callback) => {
        emitter.addEventListener(event, callback);
      },
      removeEventListener: (event, callback) => {
        emitter.removeEventListener(event, callback);
      },
    }),
    [emitter, player],
  );

  return (
    <div
      ref={containerRef}
      data-preview-player-host
      style={{
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        ...style,
      }}
    >
      <div
        ref={contentHostRef}
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width,
          height,
          marginLeft: -width / 2,
          marginTop: -height / 2,
          overflow: 'hidden',
        }}
      >
        <div
          ref={contentScaleRef}
          style={{
            width,
            height,
            transform: 'scale(1)',
            transformOrigin: 'top left',
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
});

export const PreviewPlayerHost = forwardRef<PlayerRef, PreviewPlayerHostProps>(function PreviewPlayerHost(
  {
    durationInFrames,
    fps,
    initialFrame,
    loop,
    autoPlay,
    playbackRate,
    width,
    height,
    children,
    onEnded,
    onFrameChange,
    onPlayStateChange,
    style,
  },
  ref,
) {
  return (
    <PlayerEmitterProvider>
      <ClockBridgeProvider
        fps={fps}
        durationInFrames={durationInFrames}
        initialFrame={initialFrame}
        initialPlaybackRate={playbackRate}
        loop={loop}
        onEnded={onEnded}
        onVolumeChange={() => {}}
      >
        <VideoConfigProvider
          fps={fps}
          width={width ?? 1280}
          height={height ?? 720}
          durationInFrames={durationInFrames}
        >
          <PreviewPlayerHostInner
            ref={ref}
            durationInFrames={durationInFrames}
            initialFrame={initialFrame}
            loop={loop}
            autoPlay={autoPlay}
            style={style}
            onEnded={onEnded}
            onFrameChange={onFrameChange}
            onPlayStateChange={onPlayStateChange}
          >
            {children}
          </PreviewPlayerHostInner>
        </VideoConfigProvider>
      </ClockBridgeProvider>
    </PlayerEmitterProvider>
  );
});
