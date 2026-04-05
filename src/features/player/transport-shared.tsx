import { useEffect, useImperativeHandle } from 'react';
import {
  usePlayerEmitter,
  type PlayerEventTypes,
  type CallbackListener,
} from './event-emitter';
import { useBridgedTimelineContext } from './clock';
import { usePlayer } from './use-player';

export interface BaseTransportProps {
  children: React.ReactNode;
  durationInFrames: number;
  fps: number;
  initialFrame?: number;
  loop?: boolean;
  autoPlay?: boolean;
  initiallyMuted?: boolean;
  playbackRate?: number;
  width?: number;
  height?: number;
  onEnded?: () => void;
  onFrameChange?: (frame: number) => void;
  onPlayStateChange?: (isPlaying: boolean) => void;
}

export interface TransportRef {
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seekTo: (frame: number) => void;
  getCurrentFrame: () => number;
  isPlaying: () => boolean;
  addEventListener: <E extends PlayerEventTypes>(event: E, callback: CallbackListener<E>) => void;
  removeEventListener: <E extends PlayerEventTypes>(event: E, callback: CallbackListener<E>) => void;
}

interface UseTransportBridgeOptions {
  ref: React.ForwardedRef<TransportRef>;
  durationInFrames: number;
  initialFrame?: number;
  loop?: boolean;
  autoPlay?: boolean;
  onEnded?: () => void;
  onFrameChange?: (frame: number) => void;
  onPlayStateChange?: (isPlaying: boolean) => void;
}

export function useTransportBridge({
  ref,
  durationInFrames,
  initialFrame = 0,
  loop = false,
  autoPlay = false,
  onEnded,
  onFrameChange,
  onPlayStateChange,
}: UseTransportBridgeOptions) {
  const transport = usePlayer(durationInFrames, { loop, onEnded });
  const timeline = useBridgedTimelineContext();
  const { frame: currentFrame, playing } = timeline;
  const emitter = usePlayerEmitter();

  useEffect(() => {
    if (initialFrame > 0 && currentFrame === 0) {
      transport.seek(initialFrame);
    }
  }, [currentFrame, initialFrame, transport]);

  useEffect(() => {
    if (autoPlay && !playing) {
      transport.play();
    }
  }, [autoPlay, playing, transport]);

  useEffect(() => {
    onFrameChange?.(currentFrame);
  }, [currentFrame, onFrameChange]);

  useEffect(() => {
    onPlayStateChange?.(playing);
  }, [onPlayStateChange, playing]);

  useImperativeHandle(
    ref,
    () => ({
      play: () => transport.play(),
      pause: () => transport.pause(),
      toggle: () => transport.toggle(),
      seekTo: (frame: number) => transport.seek(frame),
      getCurrentFrame: () => transport.getCurrentFrame(),
      isPlaying: () => transport.isPlaying(),
      addEventListener: <E extends PlayerEventTypes>(event: E, callback: CallbackListener<E>) => {
        emitter.addEventListener(event, callback);
      },
      removeEventListener: <E extends PlayerEventTypes>(event: E, callback: CallbackListener<E>) => {
        emitter.removeEventListener(event, callback);
      },
    }),
    [emitter, transport],
  );

  return {
    transport,
    currentFrame,
    ...timeline,
  };
}
