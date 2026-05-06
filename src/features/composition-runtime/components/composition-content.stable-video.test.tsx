import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { render } from '@testing-library/react'
import { VideoConfigProvider } from '@/features/composition-runtime/deps/player'
import { blobUrlManager } from '@/infrastructure/browser/blob-url-manager'
import {
  useCompositionsStore,
  useGizmoStore,
  useTimelineStore,
} from '@/features/composition-runtime/deps/stores'
import type { CompositionItem, TimelineTrack } from '@/types/timeline'
import { CompositionContent } from './composition-content'
import { NestedMediaResolutionProvider } from '../contexts/nested-media-resolution-context'

type TestSubComposition = ReturnType<typeof useCompositionsStore.getState>['compositions'][number]

const stableVideoSequenceSpy = vi.fn()
const resolveProxyUrlMock = vi.hoisted(() => vi.fn())
const blobUrlManagerGetSpy = vi.spyOn(blobUrlManager, 'get')

vi.mock('@/features/media-library/utils/media-resolver', () => ({
  resolveProxyUrl: resolveProxyUrlMock,
}))

vi.mock('@/features/composition-runtime/deps/player', async () => {
  const React = await import('react')

  const VideoConfigContext = React.createContext({
    fps: 30,
    width: 1280,
    height: 720,
    durationInFrames: 120,
    id: 'test',
  })
  const SequenceContext = React.createContext<{
    from: number
    durationInFrames: number
    localFrame: number
    parentFrom: number
  } | null>(null)

  return {
    AbsoluteFill: ({
      children,
      style,
    }: {
      children: React.ReactNode
      style?: React.CSSProperties
    }) => <div style={style}>{children}</div>,
    Sequence: ({
      children,
      from,
      durationInFrames,
    }: {
      children: React.ReactNode
      from: number
      durationInFrames: number
    }) => (
      <SequenceContext.Provider value={{ from, durationInFrames, localFrame: 0, parentFrom: 0 }}>
        <div data-sequence-from={from} data-sequence-duration={durationInFrames}>
          {children}
        </div>
      </SequenceContext.Provider>
    ),
    useSequenceContext: () => React.useContext(SequenceContext),
    VideoConfigProvider: ({
      children,
      fps,
      width,
      height,
      durationInFrames,
      id = 'test',
    }: {
      children: React.ReactNode
      fps: number
      width: number
      height: number
      durationInFrames: number
      id?: string
    }) => (
      <VideoConfigContext.Provider value={{ fps, width, height, durationInFrames, id }}>
        {children}
      </VideoConfigContext.Provider>
    ),
    useVideoConfig: () => React.useContext(VideoConfigContext),
  }
})

vi.mock('./item', () => ({
  Item: ({ item }: { item: { id: string } }) => <div data-testid={`sub-item-${item.id}`} />,
}))

vi.mock('./stable-video-sequence', () => ({
  StableVideoSequence: (props: {
    items: Array<{ id: string }>
    renderItem: (item: { id: string }) => React.ReactNode
  }) => {
    stableVideoSequenceSpy(props)
    return (
      <div data-testid="stable-video-sequence">
        {props.items.map((item) => (
          <div key={item.id} data-video-id={item.id}>
            {props.renderItem(item)}
          </div>
        ))}
      </div>
    )
  },
}))

describe('CompositionContent stable video identity', () => {
  beforeEach(() => {
    stableVideoSequenceSpy.mockClear()
    resolveProxyUrlMock.mockReset()
    blobUrlManagerGetSpy.mockReset()
    useCompositionsStore.setState({
      compositions: [],
      compositionById: {},
      mediaDependencyIds: [],
      mediaDependencyVersion: 0,
    })
    useTimelineStore.setState({ keyframes: [] } as Partial<
      ReturnType<typeof useTimelineStore.getState>
    >)
    useGizmoStore.setState({
      activeGizmo: null,
      previewTransform: null,
      preview: null,
      snapLines: [],
      canvasBackgroundPreview: null,
    })
  })

  it('reuses nested stable-video items when only the wrapper transform changes', () => {
    const subTracks: TimelineTrack[] = [
      {
        id: 'sub-track-video',
        name: 'V1',
        kind: 'video',
        height: 60,
        locked: false,
        visible: true,
        muted: false,
        solo: false,
        order: 0,
        items: [],
      },
    ]

    const subComp: TestSubComposition = {
      id: 'sub-comp-stable-video',
      name: 'Stable video precomp',
      items: [
        {
          id: 'nested-video',
          type: 'video',
          trackId: 'sub-track-video',
          from: 0,
          durationInFrames: 60,
          label: 'Nested video',
          src: 'blob:video',
          originId: 'nested-video-origin',
        },
      ],
      tracks: subTracks,
      transitions: [],
      keyframes: [],
      fps: 30,
      width: 1280,
      height: 720,
      durationInFrames: 60,
    }

    useCompositionsStore.setState({
      compositions: [subComp],
      compositionById: { [subComp.id]: subComp },
      mediaDependencyIds: [],
      mediaDependencyVersion: 0,
    })

    const initialItem: CompositionItem = {
      id: 'parent-comp-item',
      type: 'composition',
      compositionId: subComp.id,
      trackId: 'parent-track',
      from: 0,
      durationInFrames: 60,
      label: 'Nested comp',
      compositionWidth: 1280,
      compositionHeight: 720,
      transform: {
        x: 0,
        y: 0,
        width: 1280,
        height: 720,
        rotation: 0,
        opacity: 1,
      },
    }

    const { rerender } = render(
      <VideoConfigProvider fps={30} width={1280} height={720} durationInFrames={120}>
        <CompositionContent item={initialItem} />
      </VideoConfigProvider>,
    )

    const firstItemsRef = stableVideoSequenceSpy.mock.lastCall?.[0]?.items
    expect(firstItemsRef).toBeDefined()

    rerender(
      <VideoConfigProvider fps={30} width={1280} height={720} durationInFrames={120}>
        <CompositionContent
          item={{
            ...initialItem,
            transform: {
              ...initialItem.transform!,
              x: 180,
            },
          }}
        />
      </VideoConfigProvider>,
    )

    const secondItemsRef = stableVideoSequenceSpy.mock.lastCall?.[0]?.items
    expect(secondItemsRef).toBe(firstItemsRef)
  })

  it('prefers proxy URLs for nested video items when proxy media is enabled', () => {
    blobUrlManagerGetSpy.mockImplementation((mediaId: string) =>
      mediaId === 'media-1' ? 'blob://video-1' : null,
    )
    resolveProxyUrlMock.mockImplementation((mediaId: string) =>
      mediaId === 'media-1' ? 'proxy://video-1' : null,
    )

    const subTracks: TimelineTrack[] = [
      {
        id: 'sub-track-video',
        name: 'V1',
        kind: 'video',
        height: 60,
        locked: false,
        visible: true,
        muted: false,
        solo: false,
        order: 0,
        items: [],
      },
    ]

    const subComp: TestSubComposition = {
      id: 'sub-comp-proxy-video',
      name: 'Proxy video precomp',
      items: [
        {
          id: 'nested-video',
          type: 'video',
          trackId: 'sub-track-video',
          from: 0,
          durationInFrames: 60,
          label: 'Nested video',
          src: 'blob:stale',
          mediaId: 'media-1',
          originId: 'nested-video-origin',
        },
      ],
      tracks: subTracks,
      transitions: [],
      keyframes: [],
      fps: 30,
      width: 1280,
      height: 720,
      durationInFrames: 60,
    }

    useCompositionsStore.setState({
      compositions: [subComp],
      compositionById: { [subComp.id]: subComp },
      mediaDependencyIds: [],
      mediaDependencyVersion: 0,
    })

    const compositionItem: CompositionItem = {
      id: 'parent-comp-item',
      type: 'composition',
      compositionId: subComp.id,
      trackId: 'parent-track',
      from: 0,
      durationInFrames: 60,
      label: 'Nested comp',
      compositionWidth: 1280,
      compositionHeight: 720,
    }

    render(
      <VideoConfigProvider fps={30} width={1280} height={720} durationInFrames={120}>
        <NestedMediaResolutionProvider value="proxy">
          <CompositionContent item={compositionItem} />
        </NestedMediaResolutionProvider>
      </VideoConfigProvider>,
    )

    const nestedVideoItems = stableVideoSequenceSpy.mock.lastCall?.[0]?.items
    expect(nestedVideoItems).toHaveLength(1)
    expect(nestedVideoItems?.[0]?.src).toBe('proxy://video-1')
    expect(nestedVideoItems?.[0]?.audioSrc).toBe('blob://video-1')
  })
})
