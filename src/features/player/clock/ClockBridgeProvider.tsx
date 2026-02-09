import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { type Clock, createClock } from './Clock';
import { ClockProvider, useClock, useClockFrame, useClockIsPlaying, useClockPlaybackRate } from './ClockContext';
import {
  BridgedSetTimelineContext,
  BridgedTimelineContext,
  type SetTimelineContextValue,
  type TimelineContextValue,
} from './clock-bridge-context';

interface ClockBridgeProviderProps {
  children: React.ReactNode;
  fps: number;
  durationInFrames: number;
  initialFrame?: number;
  initiallyMuted?: boolean;
  inFrame?: number | null;
  outFrame?: number | null;
  initialPlaybackRate?: number;
  loop?: boolean;
  onEnded?: () => void;
  onVolumeChange?: (volume: number, isMuted: boolean) => void;
}

function ClockBridgeInner({
  children,
  inFrame,
  outFrame,
}: {
  children: React.ReactNode;
  inFrame: number | null;
  outFrame: number | null;
}) {
  const clock = useClock();
  const frame = useClockFrame();
  const playing = useClockIsPlaying();
  const playbackRate = useClockPlaybackRate();

  const imperativePlaying = useRef(playing);
  useEffect(() => {
    imperativePlaying.current = playing;
  }, [playing]);

  useEffect(() => {
    clock.setInPoint(inFrame);
  }, [clock, inFrame]);

  useEffect(() => {
    clock.setOutPoint(outFrame);
  }, [clock, outFrame]);

  const timelineContextValue = useMemo((): TimelineContextValue => {
    return {
      frame,
      playing,
      rootId: 'player-comp',
      playbackRate,
      imperativePlaying,
      setPlaybackRate: (rate: number) => {
        clock.playbackRate = rate;
      },
      inFrame,
      outFrame,
    };
  }, [frame, playing, playbackRate, inFrame, outFrame, clock]);

  const setFrame = useCallback(
    (action: React.SetStateAction<Record<string, number>>) => {
      if (typeof action === 'function') {
        const currentState = { 'player-comp': clock.currentFrame };
        const newState = action(currentState);
        const newFrame = newState['player-comp'];
        if (newFrame !== undefined && newFrame !== clock.currentFrame) {
          clock.seekToFrame(newFrame);
        }
      } else {
        const newFrame = action['player-comp'];
        if (newFrame !== undefined && newFrame !== clock.currentFrame) {
          clock.seekToFrame(newFrame);
        }
      }
    },
    [clock]
  );

  const setPlaying = useCallback(
    (action: React.SetStateAction<boolean>) => {
      const newPlaying = typeof action === 'function' ? action(clock.isPlaying) : action;
      if (newPlaying && !clock.isPlaying) {
        clock.play();
      } else if (!newPlaying && clock.isPlaying) {
        clock.pause();
      }
    },
    [clock]
  );

  const setTimelineContextValue = useMemo((): SetTimelineContextValue => {
    return {
      setFrame,
      setPlaying,
    };
  }, [setFrame, setPlaying]);

  return (
    <BridgedTimelineContext.Provider value={timelineContextValue}>
      <BridgedSetTimelineContext.Provider value={setTimelineContextValue}>
        {children}
      </BridgedSetTimelineContext.Provider>
    </BridgedTimelineContext.Provider>
  );
}

export function ClockBridgeProvider({
  children,
  fps,
  durationInFrames,
  initialFrame = 0,
  initialPlaybackRate = 1,
  loop = false,
  inFrame = null,
  outFrame = null,
  onEnded,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  initiallyMuted: _initiallyMuted,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onVolumeChange: _onVolumeChange,
}: ClockBridgeProviderProps): React.ReactElement {
  const clockRef = useRef<Clock | null>(null);

  if (clockRef.current === null) {
    clockRef.current = createClock({
      fps,
      durationInFrames,
      initialFrame,
      loop,
      onEnded,
    });

    if (initialPlaybackRate !== 1) {
      clockRef.current.playbackRate = initialPlaybackRate;
    }
  }

  return (
    <ClockProvider
      fps={fps}
      durationInFrames={durationInFrames}
      initialFrame={initialFrame}
      loop={loop}
      onEnded={onEnded}
      clock={clockRef.current}
    >
      <ClockBridgeInner inFrame={inFrame} outFrame={outFrame}>
        {children}
      </ClockBridgeInner>
    </ClockProvider>
  );
}
