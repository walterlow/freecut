import { useMemo, type FC, type ReactNode } from 'react';
import { VideoConfigContext, type VideoConfig } from './video-config';

export const VideoConfigProvider: FC<{
  children: ReactNode;
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
    [fps, width, height, durationInFrames, id]
  );

  return <VideoConfigContext.Provider value={config}>{children}</VideoConfigContext.Provider>;
};
