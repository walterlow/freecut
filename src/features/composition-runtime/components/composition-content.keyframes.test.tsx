import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vite-plus/test'
import { act, render, screen } from '@testing-library/react'
import { VideoConfigProvider } from '@/features/composition-runtime/deps/player'
import { blobUrlManager } from '@/infrastructure/browser/blob-url-manager'
import {
  useCompositionsStore,
  useTimelineStore,
  useGizmoStore,
} from '@/features/composition-runtime/deps/stores'
import type { CompositionItem, ShapeItem, TimelineTrack } from '@/types/timeline'
import { CompositionContent } from './composition-content'

type TestSubComposition = ReturnType<typeof useCompositionsStore.getState>['compositions'][number]
const blobUrlManagerGetSpy = vi.spyOn(blobUrlManager, 'get')

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
    useVideoSourcePool: () => ({ ensureReadyLanes: vi.fn(() => Promise.resolve()) }),
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

vi.mock('../hooks/use-transition-participant-sync', () => ({
  useTransitionParticipantSync: vi.fn(),
}))

vi.mock('./item', async () => {
  const { useItemKeyframesFromContext } = await import('../contexts/keyframes-context')

  return {
    Item: ({
      item,
      muted,
    }: {
      item: { id: string; src?: string; audioSrc?: string }
      muted?: boolean
    }) => {
      const keyframes = useItemKeyframesFromContext(item.id)
      const keyframeCount =
        keyframes?.properties.reduce((count, property) => count + property.keyframes.length, 0) ?? 0

      return (
        <div
          data-testid={`sub-item-${item.id}`}
          data-muted={muted ? 'true' : 'false'}
          data-keyframe-count={String(keyframeCount)}
          data-src={item.src ?? ''}
          data-audio-src={item.audioSrc ?? ''}
        />
      )
    },
  }
})

describe('CompositionContent keyframes', () => {
  beforeEach(() => {
    blobUrlManagerGetSpy.mockImplementation(() => null)
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

  it('provides sub-comp keyframes to nested items during parent timeline render', () => {
    const subTracks: TimelineTrack[] = [
      {
        id: 'sub-track-content',
        name: 'Content',
        height: 60,
        locked: false,
        visible: true,
        muted: false,
        solo: false,
        order: 0,
        items: [],
      },
    ]

    const contentItem: ShapeItem = {
      id: 'sub-content',
      type: 'shape',
      trackId: 'sub-track-content',
      from: 0,
      durationInFrames: 60,
      label: 'Content shape',
      shapeType: 'rectangle',
      fillColor: '#ff0000',
      transform: {
        x: 0,
        y: 0,
        width: 640,
        height: 360,
        rotation: 0,
        opacity: 1,
      },
    }

    const subComp: TestSubComposition = {
      id: 'sub-comp-1',
      name: 'Animated precomp',
      items: [contentItem],
      tracks: subTracks,
      transitions: [],
      keyframes: [
        {
          itemId: contentItem.id,
          properties: [
            {
              property: 'x',
              keyframes: [{ id: 'kf-1', frame: 0, value: 120, easing: 'linear' }],
            },
          ],
        },
      ],
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
        <CompositionContent item={compositionItem} />
      </VideoConfigProvider>,
    )

    expect(screen.getByTestId('sub-item-sub-content')).toHaveAttribute('data-keyframe-count', '1')
  })

  it('mutes linked video items inside a precomp when a paired audio item exists', () => {
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
      {
        id: 'sub-track-audio',
        name: 'A1',
        kind: 'audio',
        height: 60,
        locked: false,
        visible: true,
        muted: false,
        solo: false,
        order: 1,
        items: [],
      },
    ]

    const subVideo = {
      id: 'sub-video',
      type: 'video' as const,
      trackId: 'sub-track-video',
      from: 0,
      durationInFrames: 60,
      label: 'Nested video',
      src: 'blob:video',
      mediaId: 'media-1',
      linkedGroupId: 'group-1',
    }

    const subAudio = {
      id: 'sub-audio',
      type: 'audio' as const,
      trackId: 'sub-track-audio',
      from: 0,
      durationInFrames: 60,
      label: 'Nested audio',
      src: 'blob:audio',
      mediaId: 'media-1',
      linkedGroupId: 'group-1',
    }

    const subComp: TestSubComposition = {
      id: 'sub-comp-audio-owned',
      name: 'Audio owned precomp',
      items: [subVideo, subAudio],
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
      id: 'parent-comp-item-audio-owned',
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
        <CompositionContent item={compositionItem} />
      </VideoConfigProvider>,
    )

    expect(screen.getByTestId('sub-item-sub-video')).toHaveAttribute('data-muted', 'true')
    expect(screen.getByTestId('sub-item-sub-audio')).toHaveAttribute('data-muted', 'false')
  })

  it('renders only visual sub-items in visual-only mode', () => {
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
      {
        id: 'sub-track-audio',
        name: 'A1',
        kind: 'audio',
        height: 60,
        locked: false,
        visible: true,
        muted: false,
        solo: false,
        order: 1,
        items: [],
      },
    ]

    const subComp: TestSubComposition = {
      id: 'sub-comp-visual-only',
      name: 'Visual only precomp',
      items: [
        {
          id: 'sub-video-visual-only',
          type: 'video',
          trackId: 'sub-track-video',
          from: 0,
          durationInFrames: 60,
          label: 'Nested video',
          src: 'blob:video',
          mediaId: 'media-1',
        },
        {
          id: 'sub-audio-visual-only',
          type: 'audio',
          trackId: 'sub-track-audio',
          from: 0,
          durationInFrames: 60,
          label: 'Nested audio',
          src: 'blob:audio',
          mediaId: 'media-1',
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
      id: 'parent-comp-item-visual-only',
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
        <CompositionContent item={compositionItem} renderMode="visual-only" />
      </VideoConfigProvider>,
    )

    expect(screen.getByTestId('sub-item-sub-video-visual-only')).toBeInTheDocument()
    expect(screen.queryByTestId('sub-item-sub-audio-visual-only')).toBeNull()
  })

  it('renders only audio sub-items for compound audio wrappers in audio-only mode', () => {
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
      {
        id: 'sub-track-audio',
        name: 'A1',
        kind: 'audio',
        height: 60,
        locked: false,
        visible: true,
        muted: false,
        solo: false,
        order: 1,
        items: [],
      },
    ]

    const subComp: TestSubComposition = {
      id: 'sub-comp-audio-only',
      name: 'Audio only precomp',
      items: [
        {
          id: 'sub-video-audio-only',
          type: 'video',
          trackId: 'sub-track-video',
          from: 0,
          durationInFrames: 60,
          label: 'Nested video',
          src: 'blob:video',
          mediaId: 'media-1',
        },
        {
          id: 'sub-audio-audio-only',
          type: 'audio',
          trackId: 'sub-track-audio',
          from: 0,
          durationInFrames: 60,
          label: 'Nested audio',
          src: 'blob:audio',
          mediaId: 'media-1',
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

    render(
      <VideoConfigProvider fps={30} width={1280} height={720} durationInFrames={120}>
        <CompositionContent
          item={{
            id: 'parent-comp-audio-wrapper',
            type: 'audio',
            trackId: 'parent-audio-track',
            from: 0,
            durationInFrames: 60,
            label: 'Nested comp audio',
            compositionId: subComp.id,
            src: '',
          }}
          renderMode="audio-only"
        />
      </VideoConfigProvider>,
    )

    expect(screen.queryByTestId('sub-item-sub-video-audio-only')).toBeNull()
    expect(screen.getByTestId('sub-item-sub-audio-audio-only')).toBeInTheDocument()
  })

  it('clears stale nested media src until fresh blob urls exist', () => {
    const subTracks: TimelineTrack[] = [
      {
        id: 'sub-track-video-stale',
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
      {
        id: 'sub-track-audio-stale',
        name: 'A1',
        kind: 'audio',
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
      id: 'sub-comp-stale-audio',
      name: 'Stale audio precomp',
      items: [
        {
          id: 'sub-video-stale',
          type: 'video',
          trackId: 'sub-track-video-stale',
          from: 0,
          durationInFrames: 60,
          label: 'Nested video',
          src: 'blob:stale-video',
          audioSrc: 'blob:stale-video-audio',
          mediaId: 'media-video-stale',
        },
        {
          id: 'sub-audio-stale',
          type: 'audio',
          trackId: 'sub-track-audio-stale',
          from: 0,
          durationInFrames: 60,
          label: 'Nested audio',
          src: 'blob:stale-audio',
          mediaId: 'media-stale',
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

    const { rerender } = render(
      <VideoConfigProvider fps={30} width={1280} height={720} durationInFrames={120}>
        <CompositionContent
          item={{
            id: 'parent-comp-stale-wrapper',
            type: 'composition',
            trackId: 'parent-video-track',
            from: 0,
            durationInFrames: 60,
            label: 'Nested stale comp',
            compositionId: subComp.id,
            compositionWidth: 1280,
            compositionHeight: 720,
          }}
        />
      </VideoConfigProvider>,
    )

    expect(screen.getByTestId('sub-item-sub-video-stale')).toHaveAttribute('data-src', '')
    expect(screen.getByTestId('sub-item-sub-video-stale')).toHaveAttribute('data-audio-src', '')
    expect(screen.getByTestId('sub-item-sub-audio-stale')).toHaveAttribute('data-src', '')

    blobUrlManagerGetSpy.mockImplementation((mediaId: string) =>
      mediaId === 'media-stale'
        ? 'blob:fresh-stale-audio'
        : mediaId === 'media-video-stale'
          ? 'blob:fresh-stale-video'
          : null,
    )

    const refreshedSubComp: TestSubComposition = {
      ...subComp,
      items: [...subComp.items],
    }
    act(() => {
      useCompositionsStore.setState({
        compositions: [refreshedSubComp],
        compositionById: { [refreshedSubComp.id]: refreshedSubComp },
        mediaDependencyIds: [],
        mediaDependencyVersion: 1,
      })
    })

    rerender(
      <VideoConfigProvider fps={30} width={1280} height={720} durationInFrames={120}>
        <CompositionContent
          item={{
            id: 'parent-comp-stale-wrapper',
            type: 'composition',
            trackId: 'parent-video-track',
            from: 0,
            durationInFrames: 60,
            label: 'Nested stale comp',
            compositionId: subComp.id,
            compositionWidth: 1280,
            compositionHeight: 720,
          }}
        />
      </VideoConfigProvider>,
    )

    expect(screen.getByTestId('sub-item-sub-video-stale')).toHaveAttribute(
      'data-src',
      'blob:fresh-stale-video',
    )
    expect(screen.getByTestId('sub-item-sub-video-stale')).toHaveAttribute(
      'data-audio-src',
      'blob:fresh-stale-video',
    )
    expect(screen.getByTestId('sub-item-sub-audio-stale')).toHaveAttribute(
      'data-src',
      'blob:fresh-stale-audio',
    )
  })

  it('keeps nested compound visuals hidden when the parent wrapper is hidden', () => {
    const subTracks: TimelineTrack[] = [
      {
        id: 'sub-track-video-hidden',
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
      id: 'sub-comp-hidden-parent',
      name: 'Hidden parent precomp',
      items: [
        {
          id: 'sub-video-hidden-parent',
          type: 'video',
          trackId: 'sub-track-video-hidden',
          from: 0,
          durationInFrames: 60,
          label: 'Nested video',
          src: 'blob:video',
          mediaId: 'media-1',
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
      id: 'parent-comp-item-hidden',
      type: 'composition',
      compositionId: subComp.id,
      trackId: 'parent-track',
      from: 0,
      durationInFrames: 60,
      label: 'Nested comp',
      compositionWidth: 1280,
      compositionHeight: 720,
    }

    const { container } = render(
      <VideoConfigProvider fps={30} width={1280} height={720} durationInFrames={120}>
        <CompositionContent item={compositionItem} parentVisible={false} />
      </VideoConfigProvider>,
    )

    expect(screen.getByTestId('sub-item-sub-video-hidden-parent')).toBeInTheDocument()

    const visibilityStyles = Array.from(container.querySelectorAll('div[style]'))
      .map((element) => element.getAttribute('style') ?? '')
      .filter((style) => style.includes('visibility:'))

    expect(visibilityStyles.length).toBeGreaterThan(0)
    expect(visibilityStyles.every((style) => style.includes('visibility: hidden'))).toBe(true)
  })
})
