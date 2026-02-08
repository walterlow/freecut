/**
 * Video Config Context - Provides video configuration for Composition components
 * 
 * This context mimics Composition's Internals.useVideoConfig() so that
 * MainComposition and other Composition components work correctly.
 */

import React, { createContext, useContext, useMemo } from 'react';

// Video config type matching Composition's VideoConfig
interface VideoConfig {
  fps: number;
  width: number;
  height: number;
  durationInFrames: number;
  id: string;
}

// Context for video config
const VideoConfigContext = createContext<VideoConfig | null>(null);

/**
 * Hook to get the video config
 * @throws Error if not inside a player context
 */
export function useVideoConfig(): VideoConfig {
  const config = useContext(VideoConfigContext);
  if (!config) {
    throw new Error('No video config found. Make sure to use this component within a Player.');
  }
  return config;
}

/**
 * Video Config Provider Component
 */
export const VideoConfigProvider: React.FC<{
  children: React.ReactNode;
  fps: number;
  width: number;
  height: number;
  durationInFrames: number;
  id?: string;
}> = ({ children, fps, width, height, durationInFrames, id = 'player' }) => {
  const config = useMemo<VideoConfig>(
    () => ({
      fps,
      width,
      height,
      durationInFrames,
      id,
    }),
    [fps, width, height, durationInFrames, id],
  );

  return (
    <VideoConfigContext.Provider value={config}>
      {children}
    </VideoConfigContext.Provider>
  );
};
