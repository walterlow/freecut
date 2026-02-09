import React, { useMemo, useRef, type ReactNode } from 'react';
import { createClock, type Clock, type ClockConfig } from './Clock';
import { ClockContext } from './clock-hooks';

interface ClockProviderProps {
  children: ReactNode;
  fps: number;
  durationInFrames: number;
  initialFrame?: number;
  loop?: boolean;
  onEnded?: () => void;
  clock?: Clock;
}

export function ClockProvider({
  children,
  fps,
  durationInFrames,
  initialFrame = 0,
  loop = false,
  onEnded,
  clock: externalClock,
}: ClockProviderProps): React.ReactElement {
  const clockRef = useRef<Clock | null>(null);

  if (clockRef.current === null) {
    if (externalClock) {
      clockRef.current = externalClock;
    } else {
      const config: ClockConfig = {
        fps,
        durationInFrames,
        initialFrame,
        loop,
        onEnded,
      };
      clockRef.current = createClock(config);
    }
  }

  const clock = clockRef.current;

  React.useEffect(() => {
    if (clock.fps !== fps) {
      clock.fps = fps;
    }
  }, [clock, fps]);

  React.useEffect(() => {
    if (clock.durationInFrames !== durationInFrames) {
      clock.durationInFrames = durationInFrames;
    }
  }, [clock, durationInFrames]);

  React.useEffect(() => {
    if (clock.loop !== loop) {
      clock.loop = loop;
    }
  }, [clock, loop]);

  React.useEffect(() => {
    return () => {
      if (!externalClock) {
        clock.dispose();
      }
    };
  }, [clock, externalClock]);

  const contextValue = useMemo(
    () => ({
      clock,
    }),
    [clock]
  );

  return <ClockContext.Provider value={contextValue}>{children}</ClockContext.Provider>;
}
