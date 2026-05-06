import { describe, expect, it, vi } from 'vite-plus/test'
import { render, screen } from '@testing-library/react'
import type { CSSProperties, ReactNode, RefObject } from 'react'
import type { CompositionInputProps } from '@/types/export'

const playbackState = vi.hoisted(() => ({
  useProxy: true,
}))

vi.mock('@/shared/state/playback', () => {
  const usePlaybackStore = Object.assign(
    (selector: (state: typeof playbackState) => unknown) => selector(playbackState),
    { getState: () => playbackState },
  )

  return { usePlaybackStore }
})

vi.mock('@/features/preview/deps/player-core', () => ({
  Player: ({
    children,
    layoutSize,
    style,
  }: {
    children: ReactNode
    layoutSize?: { width: number; height: number }
    style?: CSSProperties
  }) => (
    <div
      data-testid="player"
      data-layout-width={layoutSize?.width}
      data-layout-height={layoutSize?.height}
      style={style}
    >
      {children}
    </div>
  ),
}))

vi.mock('@/features/preview/deps/composition-runtime', () => ({
  MainComposition: ({ useProxyMedia }: { useProxyMedia?: boolean }) => (
    <div data-testid="main-composition" data-use-proxy-media={useProxyMedia ? 'true' : 'false'} />
  ),
}))

import { getPreviewPixelSnapOffset, getPreviewPixelSnapSize } from '../utils/preview-pixel-snap'
import { PreviewStage } from './preview-stage'

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
  }
}

function createRef<T>(): RefObject<T | null> {
  return { current: null }
}

describe('getPreviewPixelSnapOffset', () => {
  it('returns the subpixel correction needed to land the preview surface on device pixels', () => {
    expect(getPreviewPixelSnapOffset({ left: 856.390625, top: 64.453125 }, 1)).toEqual({
      x: -0.390625,
      y: -0.453125,
    })

    expect(getPreviewPixelSnapOffset({ left: 10.25, top: 20.75 }, 2)).toEqual({
      x: 0.25,
      y: 0.25,
    })
  })
})

describe('getPreviewPixelSnapSize', () => {
  it('snaps fitted preview dimensions to device pixels', () => {
    expect(getPreviewPixelSnapSize({ width: 590.21875, height: 332 }, 1)).toEqual({
      width: 590,
      height: 332,
    })

    expect(getPreviewPixelSnapSize({ width: 590.25, height: 331.75 }, 2)).toEqual({
      width: 590.5,
      height: 332,
    })
  })
})

describe('PreviewStage', () => {
  it('passes proxy playback mode down to nested composition rendering', () => {
    playbackState.useProxy = true

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
        isRenderedOverlayVisible={false}
        inputProps={createInputProps()}
        onBackgroundClick={() => {}}
        onFrameChange={() => {}}
        onPlayStateChange={() => {}}
        setPlayerContainerRefCallback={() => {}}
      />,
    )

    expect(screen.getByTestId('main-composition')).toHaveAttribute('data-use-proxy-media', 'true')
  })

  it('keeps render surfaces on one exact geometry and passes that geometry to Player layout', () => {
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
        isRenderedOverlayVisible={true}
        inputProps={createInputProps()}
        onBackgroundClick={() => {}}
        onFrameChange={() => {}}
        onPlayStateChange={() => {}}
        setPlayerContainerRefCallback={() => {}}
      />,
    )

    const player = screen.getByTestId('player')
    const canvases = document.querySelectorAll('canvas')

    expect(player).toHaveStyle({ width: '100%', height: '100%' })
    expect(player).toHaveAttribute('data-layout-width', '1280')
    expect(player).toHaveAttribute('data-layout-height', '720')
    expect(player.style.marginLeft).toBe('')
    expect(player.style.marginTop).toBe('')

    canvases.forEach((canvas) => {
      expect(canvas).toHaveStyle({ width: '100%', height: '100%' })
      expect(canvas.style.left).toBe('')
      expect(canvas.style.top).toBe('')
    })
  })
})
