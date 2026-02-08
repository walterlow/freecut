/**
 * ClockBridge.tsx - Bridge between Clock and existing player context
 *
 * This component provides backwards compatibility with the existing
 * player-context.tsx API while using the new Clock internally.
 *
 * It exposes the same context values that components expect from
 * the original TimelineContext and SetTimelineContext, but powered
 * by the Clock system.
 *
 * Migration strategy:
 * 1. Replace PlayerContextProvider with ClockBridgeProvider
 * 2. Existing components continue to work unchanged
 * 3. New components can use the Clock API directly
 * 4. Eventually migrate all components to Clock and remove the bridge
 */

import React, { createContext, useContext, useMemo, useRef, useCallback, useEffect } from 'react';
import { Clock, createClock } from './Clock';
import { ClockProvider, useClock, useClockFrame, useClockIsPlaying, useClockPlaybackRate } from './ClockContext';

// ============================================
// Legacy Context Types (matching player-context.tsx)
// ============================================

interface TimelineContextValue {
  frame: number;
  playing: boolean;
  rootId: string;
  playbackRate: number;
  imperativePlaying: React.MutableRefObject<boolean>;
  setPlaybackRate: (rate: number) => void;
  inFrame: number | null;
  outFrame: number | null;
}

interface SetTimelineContextValue {
  setFrame: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  setPlaying: React.Dispatch<React.SetStateAction<boolean>>;
}

// ============================================
// Legacy Contexts
// ============================================

const BridgedTimelineContext = createContext<TimelineContextValue | null>(null);
const BridgedSetTimelineContext = createContext<SetTimelineContextValue | null>(null);

// ============================================
// Provider Props
// ============================================

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

// ============================================
// Inner Bridge Component (uses Clock context)
// ============================================

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

  // Imperative playing ref (for compatibility with existing code)
  const imperativePlaying = useRef(playing);
  useEffect(() => {
    imperativePlaying.current = playing;
  }, [playing]);

  // Set in/out points on clock
  useEffect(() => {
    clock.setInPoint(inFrame);
  }, [clock, inFrame]);

  useEffect(() => {
    clock.setOutPoint(outFrame);
  }, [clock, outFrame]);

  // Timeline context value (matches original interface)
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

  // Create stable setFrame and setPlaying functions that work with Clock
  const setFrame = useCallback(
    (action: React.SetStateAction<Record<string, number>>) => {
      // Handle both function and direct value
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

  // Set timeline context value
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

// ============================================
// Main Provider Component
// ============================================

/**
 * ClockBridgeProvider - Drop-in replacement for PlayerContextProvider
 *
 * Provides the same context values as PlayerContextProvider but
 * uses the Clock system internally. Existing components that use
 * useTimelineContext() and useSetTimelineContext() will work unchanged.
 */
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
  // These are kept for API compatibility but not used by Clock
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  initiallyMuted: _initiallyMuted,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onVolumeChange: _onVolumeChange,
}: ClockBridgeProviderProps): React.ReactElement {
  // Create clock with initial config
  const clockRef = useRef<Clock | null>(null);

  if (clockRef.current === null) {
    clockRef.current = createClock({
      fps,
      durationInFrames,
      initialFrame,
      loop,
      onEnded,
    });

    // Set initial playback rate
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

// ============================================
// Legacy Hook Exports (matching player-context.tsx)
// ============================================

/**
 * useTimelineContext - Get the timeline context (bridged from Clock)
 */
export function useBridgedTimelineContext(): TimelineContextValue {
  const context = useContext(BridgedTimelineContext);
  if (!context) {
    throw new Error('useBridgedTimelineContext must be used within a ClockBridgeProvider');
  }
  return context;
}

/**
 * useSetTimelineContext - Get the timeline setter context (bridged from Clock)
 */
export function useBridgedSetTimelineContext(): SetTimelineContextValue {
  const context = useContext(BridgedSetTimelineContext);
  if (!context) {
    throw new Error('useBridgedSetTimelineContext must be used within a ClockBridgeProvider');
  }
  return context;
}

/**
 * useBridgedCurrentFrame - Get the current frame (bridged)
 */
export function useBridgedCurrentFrame(): number {
  return useBridgedTimelineContext().frame;
}

/**
 * useBridgedIsPlaying - Get the playing state (bridged)
 */
export function useBridgedIsPlaying(): boolean {
  return useBridgedTimelineContext().playing;
}

/**
 * useBridgedSetTimelineFrame - Get a function to set the frame (bridged)
 */
export function useBridgedSetTimelineFrame(): (frame: number) => void {
  const { setFrame } = useBridgedSetTimelineContext();
  const { inFrame, outFrame } = useBridgedTimelineContext();

  return useCallback(
    (newFrame: number) => {
      // Clamp to in/out bounds if set
      let clampedFrame = newFrame;
      if (inFrame !== null && clampedFrame < inFrame) {
        clampedFrame = inFrame;
      }
      if (outFrame !== null && clampedFrame > outFrame) {
        clampedFrame = outFrame;
      }

      setFrame((c) => ({
        ...c,
        'player-comp': clampedFrame,
      }));
    },
    [setFrame, inFrame, outFrame]
  );
}

/**
 * useBridgedActualFirstFrame - Get the actual first frame (considering inFrame)
 */
export function useBridgedActualFirstFrame(): number {
  const { inFrame } = useBridgedTimelineContext();
  return inFrame ?? 0;
}

/**
 * useBridgedActualLastFrame - Get the actual last frame (considering outFrame)
 */
export function useBridgedActualLastFrame(durationInFrames: number): number {
  const { outFrame } = useBridgedTimelineContext();
  return outFrame ?? durationInFrames - 1;
}
