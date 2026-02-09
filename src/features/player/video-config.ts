import { createContext, useContext } from 'react';

export interface VideoConfig {
  fps: number;
  width: number;
  height: number;
  durationInFrames: number;
  id: string;
}

export const VideoConfigContext = createContext<VideoConfig | null>(null);

export function useVideoConfig(): VideoConfig {
  const config = useContext(VideoConfigContext);
  if (!config) {
    throw new Error('No video config found. Make sure to use this component within a Player.');
  }
  return config;
}
