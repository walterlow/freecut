import React, {
  forwardRef,
} from 'react';
import { PlayerTransportProviders } from './PlayerTransportProviders';
import {
  usePlayerTransportBridge,
  type BasePlayerTransportProps,
  type PlayerRef,
} from './player-transport-shared';

export type HeadlessPlayerTransportProps = BasePlayerTransportProps;

const HeadlessPlayerTransportInner = forwardRef<PlayerRef, HeadlessPlayerTransportProps>(
  (
    {
      children,
      durationInFrames,
      initialFrame = 0,
      loop = false,
      autoPlay = false,
      onEnded,
      onFrameChange,
      onPlayStateChange,
    },
    ref,
  ) => {
    usePlayerTransportBridge({
      ref,
      durationInFrames,
      initialFrame,
      loop,
      autoPlay,
      onEnded,
      onFrameChange,
      onPlayStateChange,
    });

    return (
      <div
        aria-hidden="true"
        data-player-transport-host
        style={{
          position: 'absolute',
          width: 0,
          height: 0,
          overflow: 'hidden',
          opacity: 0,
          pointerEvents: 'none',
        }}
      >
        {children}
      </div>
    );
  },
);
HeadlessPlayerTransportInner.displayName = 'HeadlessPlayerTransportInner';

export const HeadlessPlayerTransport = forwardRef<PlayerRef, HeadlessPlayerTransportProps>(
  (props, ref) => {
    const {
      durationInFrames,
      fps,
      initialFrame,
      initiallyMuted,
      playbackRate,
      loop,
      onEnded,
      width,
      height,
    } = props;

    return (
      <PlayerTransportProviders
        fps={fps}
        durationInFrames={durationInFrames}
        initialFrame={initialFrame}
        initiallyMuted={initiallyMuted}
        playbackRate={playbackRate}
        loop={loop}
        onEnded={onEnded}
        width={width}
        height={height}
      >
        <HeadlessPlayerTransportInner ref={ref} {...props} />
      </PlayerTransportProviders>
    );
  },
);
HeadlessPlayerTransport.displayName = 'HeadlessPlayerTransport';
