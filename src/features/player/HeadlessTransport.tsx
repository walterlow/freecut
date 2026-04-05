import React, {
  forwardRef,
} from 'react';
import { TransportProviders } from './TransportProviders';
import {
  useTransportBridge,
  type BaseTransportProps,
  type TransportRef,
} from './transport-shared';

export type HeadlessTransportProps = BaseTransportProps;

const HeadlessTransportInner = forwardRef<TransportRef, HeadlessTransportProps>(
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
    useTransportBridge({
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
        data-transport-host
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
HeadlessTransportInner.displayName = 'HeadlessTransportInner';

export const HeadlessTransport = forwardRef<TransportRef, HeadlessTransportProps>(
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
      <TransportProviders
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
        <HeadlessTransportInner ref={ref} {...props} />
      </TransportProviders>
    );
  },
);
HeadlessTransport.displayName = 'HeadlessTransport';
