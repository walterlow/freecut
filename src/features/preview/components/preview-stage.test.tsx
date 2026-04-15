import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode, RefObject } from 'react';
import type { CompositionInputProps } from '@/types/export';

const playbackState = vi.hoisted(() => ({
  useProxy: true,
}));

vi.mock('@/shared/state/playback', () => {
  const usePlaybackStore = Object.assign(
    (selector: (state: typeof playbackState) => unknown) => selector(playbackState),
    { getState: () => playbackState },
  );

  return { usePlaybackStore };
});

vi.mock('@/features/preview/deps/player-core', () => ({
  Player: ({ children }: { children: ReactNode }) => <div data-testid="player">{children}</div>,
}));

vi.mock('@/features/preview/deps/composition-runtime', () => ({
  MainComposition: ({ useProxyMedia }: { useProxyMedia?: boolean }) => (
    <div data-testid="main-composition" data-use-proxy-media={useProxyMedia ? 'true' : 'false'} />
  ),
}));

import { PreviewStage } from './preview-stage';

function createInputProps(): CompositionInputProps {
  return {
    fps: 30,
    durationInFrames: 120,
    width: 1280,
    height: 720,
    tracks: [],
    transitions: [],
    keyframes: [],
    backgroundColor: '#000000',
  };
}

function createRef<T>(): RefObject<T | null> {
  return { current: null };
}

describe('PreviewStage', () => {
  it('passes proxy playback mode down to nested composition rendering', () => {
    playbackState.useProxy = true;

    render(
      <PreviewStage
        backgroundRef={createRef<HTMLDivElement>()}
        playerRef={createRef()}
        scrubCanvasRef={createRef<HTMLCanvasElement>()}
        gpuEffectsCanvasRef={createRef<HTMLCanvasElement>()}
        needsOverflow={false}
        playerSize={{ width: 1280, height: 720 }}
        playerRenderSize={{ width: 1280, height: 720 }}
        totalFrames={120}
        fps={30}
        isResolving={false}
        shouldShowRenderedCanvas={false}
        inputProps={createInputProps()}
        onBackgroundClick={() => {}}
        onFrameChange={() => {}}
        onPlayStateChange={() => {}}
        setPlayerContainerRefCallback={() => {}}
      />
    );

    expect(screen.getByTestId('main-composition')).toHaveAttribute('data-use-proxy-media', 'true');
  });

  it('shows the rendered preview canvas when the stage is told it owns presentation', () => {
    const { container } = render(
      <PreviewStage
        backgroundRef={createRef<HTMLDivElement>()}
        playerRef={createRef()}
        scrubCanvasRef={createRef<HTMLCanvasElement>()}
        gpuEffectsCanvasRef={createRef<HTMLCanvasElement>()}
        needsOverflow={false}
        playerSize={{ width: 1280, height: 720 }}
        playerRenderSize={{ width: 1280, height: 720 }}
        totalFrames={120}
        fps={30}
        isResolving={false}
        shouldShowRenderedCanvas
        inputProps={createInputProps()}
        onBackgroundClick={() => {}}
        onFrameChange={() => {}}
        onPlayStateChange={() => {}}
        setPlayerContainerRefCallback={() => {}}
      />
    );

    const scrubCanvas = container.querySelector('canvas');
    expect(scrubCanvas).not.toBeNull();
    expect(scrubCanvas).toHaveStyle({ visibility: 'visible' });
  });
});
