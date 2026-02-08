/**
 * VideoSourcePoolContext.tsx - React context for VideoSourcePool
 *
 * Provides the video source pool to components that need to acquire/release
 * video elements for playback.
 */

import { createContext, useContext } from 'react';
import { VideoSourcePool, getGlobalVideoSourcePool } from './VideoSourcePool';

const VideoSourcePoolContext = createContext<VideoSourcePool | null>(null);

/**
 * Hook to access the VideoSourcePool from context.
 * Falls back to global pool if no provider is found.
 */
export function useVideoSourcePool(): VideoSourcePool {
  const contextPool = useContext(VideoSourcePoolContext);
  return contextPool ?? getGlobalVideoSourcePool();
}
