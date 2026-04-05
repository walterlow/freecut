import { useEffect, useImperativeHandle } from 'react';
import {
  usePlayerEmitter,
  type PlayerEventTypes,
  type CallbackListener,
} from './event-emitter';
import { useBridgedTimelineContext } from './clock';
import { usePlayer } from './use-player';

export interface BasePlayerTransportProps {
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

export interface PlayerRef {
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seekTo: (frame: number) => void;
  getCurrentFrame: () => number;
  isPlaying: () => boolean;
  addEventListener: <E extends PlayerEventTypes>(event: E, callback: CallbackListener<E>) => void;
  removeEventListener: <E extends PlayerEventTypes>(event: E, callback: CallbackListener<E>) => void;
}

interface UsePlayerTransportBridgeOptions {
  ref: React.ForwardedRef<PlayerRef>;
  durationInFrames: number;
  initialFrame?: number;
  loop?: boolean;
  autoPlay?: boolean;
  onEnded?: () => void;
  onFrameChange?: (frame: number) => void;
  onPlayStateChange?: (isPlaying: boolean) => void;
}

export function usePlayerTransportBridge({
  ref,
  durationInFrames,
  initialFrame = 0,
  loop = false,
  autoPlay = false,
  onEnded,
  onFrameChange,
  onPlayStateChange,
}: UsePlayerTransportBridgeOptions) {
  const player = usePlayer(durationInFrames, { loop, onEnded });
  const timeline = useBridgedTimelineContext();
  const { frame: currentFrame, playing } = timeline;
  const emitter = usePlayerEmitter();

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

  useImperativeHandle(
    ref,
    () => ({
      play: () => player.play(),
      pause: () => player.pause(),
      toggle: () => player.toggle(),
      seekTo: (frame: number) => player.seek(frame),
      getCurrentFrame: () => player.getCurrentFrame(),
      isPlaying: () => player.isPlaying(),
      addEventListener: <E extends PlayerEventTypes>(event: E, callback: CallbackListener<E>) => {
        emitter.addEventListener(event, callback);
      },
      removeEventListener: <E extends PlayerEventTypes>(event: E, callback: CallbackListener<E>) => {
        emitter.removeEventListener(event, callback);
      },
    }),
    [emitter, player],
  );

  return {
    player,
    currentFrame,
    ...timeline,
  };
}
