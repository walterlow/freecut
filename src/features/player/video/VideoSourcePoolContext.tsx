/**
 * VideoSourcePoolContext.tsx - React context for VideoSourcePool
 *
 * Provides the video source pool to components that need to acquire/release
 * video elements for playback.
 */

import React, { createContext, useContext, useMemo, useEffect } from 'react';
import { VideoSourcePool, getGlobalVideoSourcePool } from './VideoSourcePool';

const VideoSourcePoolContext = createContext<VideoSourcePool | null>(null);

export interface VideoSourcePoolProviderProps {
  children: React.ReactNode;
  /** Optional custom pool instance. Uses global singleton if not provided. */
  pool?: VideoSourcePool;
}

/**
 * Provider component that supplies a VideoSourcePool to children.
 * Uses the global singleton by default.
 */
export const VideoSourcePoolProvider: React.FC<VideoSourcePoolProviderProps> = ({
  children,
  pool: customPool,
}) => {
  const pool = useMemo(
    () => customPool ?? getGlobalVideoSourcePool(),
    [customPool]
  );

  // Cleanup on unmount (only if using global pool)
  useEffect(() => {
    return () => {
      if (!customPool) {
        // Don't dispose immediately - other components might still be using it
        // The global pool will be cleaned up when the app closes
      }
    };
  }, [customPool]);

  return (
    <VideoSourcePoolContext.Provider value={pool}>
      {children}
    </VideoSourcePoolContext.Provider>
  );
};

/**
 * Hook to access the VideoSourcePool from context.
 * Falls back to global pool if no provider is found.
 */
export function useVideoSourcePool(): VideoSourcePool {
  const contextPool = useContext(VideoSourcePoolContext);
  return contextPool ?? getGlobalVideoSourcePool();
}

/**
 * Hook to get pool statistics for debugging.
 */
export { usePoolStats } from './PooledVideoLayer';
