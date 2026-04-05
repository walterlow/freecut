import React from 'react';
import { PlayerEmitterProvider } from './event-emitter';
import { ClockBridgeProvider } from './clock';
import { VideoConfigProvider } from './video-config-context';

interface TransportProvidersProps {
  children: React.ReactNode;
  durationInFrames: number;
  fps: number;
  initialFrame?: number;
  initiallyMuted?: boolean;
  playbackRate?: number;
  loop?: boolean;
  onEnded?: () => void;
  width?: number;
  height?: number;
}

export function TransportProviders({
  children,
  durationInFrames,
  fps,
  initialFrame,
  initiallyMuted,
  playbackRate,
  loop,
  onEnded,
  width = 1280,
  height = 720,
}: TransportProvidersProps): React.ReactElement {
  return (
    <PlayerEmitterProvider>
      <ClockBridgeProvider
        fps={fps}
        durationInFrames={durationInFrames}
        initialFrame={initialFrame}
        initiallyMuted={initiallyMuted}
        initialPlaybackRate={playbackRate}
        loop={loop}
        onEnded={onEnded}
        onVolumeChange={() => {}}
      >
        <VideoConfigProvider
          fps={fps}
          width={width}
          height={height}
          durationInFrames={durationInFrames}
        >
          {children}
        </VideoConfigProvider>
      </ClockBridgeProvider>
    </PlayerEmitterProvider>
  );
}
