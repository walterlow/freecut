import { createContext, useCallback, useContext, useSyncExternalStore } from 'react';
import type { Clock } from './Clock';

interface ClockContextValue {
  clock: Clock;
}

export const ClockContext = createContext<ClockContextValue | null>(null);

export function useClock(): Clock {
  const context = useContext(ClockContext);
  if (!context) {
    throw new Error('useClock must be used within a ClockProvider');
  }
  return context.clock;
}

export function useClockFrame(): number {
  const clock = useClock();

  const subscribe = useCallback(
    (callback: () => void) => {
      clock.addEventListener('framechange', callback);
      clock.addEventListener('seek', callback);

      return () => {
        clock.removeEventListener('framechange', callback);
        clock.removeEventListener('seek', callback);
      };
    },
    [clock]
  );

  const getSnapshot = useCallback(() => clock.currentFrame, [clock]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useClockIsPlaying(): boolean {
  const clock = useClock();

  const subscribe = useCallback(
    (callback: () => void) => {
      clock.addEventListener('play', callback);
      clock.addEventListener('pause', callback);
      clock.addEventListener('ended', callback);

      return () => {
        clock.removeEventListener('play', callback);
        clock.removeEventListener('pause', callback);
        clock.removeEventListener('ended', callback);
      };
    },
    [clock]
  );

  const getSnapshot = useCallback(() => clock.isPlaying, [clock]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useClockPlaybackRate(): number {
  const clock = useClock();

  const subscribe = useCallback(
    (callback: () => void) => {
      clock.addEventListener('ratechange', callback);

      return () => {
        clock.removeEventListener('ratechange', callback);
      };
    },
    [clock]
  );

  const getSnapshot = useCallback(() => clock.playbackRate, [clock]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
