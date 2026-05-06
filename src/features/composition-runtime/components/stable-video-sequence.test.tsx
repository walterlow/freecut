import React from 'react'
import { describe, expect, it, vi, beforeEach } from 'vite-plus/test'
import { render, screen } from '@testing-library/react'

const sequenceContextValue = { localFrame: 28 }
const ensureReadyLanesMock = vi.fn(() => Promise.resolve())

vi.mock('@/features/composition-runtime/deps/player', () => ({
  Sequence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useSequenceContext: () => sequenceContextValue,
  useVideoSourcePool: () => ({ ensureReadyLanes: ensureReadyLanesMock }),
}))

vi.mock('../hooks/use-player-compat', () => ({
  useVideoConfig: () => ({ fps: 30, width: 1280, height: 720, durationInFrames: 120 }),
}))

vi.mock('../hooks/use-transition-participant-sync', () => ({
  useTransitionParticipantSync: vi.fn(),
}))

vi.mock('@/features/composition-runtime/deps/stores', () => ({
  useMediaLibraryStore: (
    selector: (state: { mediaItems: Array<{ id: string; fps: number }> }) => unknown,
  ) => selector({ mediaItems: [] }),
}))

vi.mock('./video-content', () => ({
  VideoContent: ({ item }: { item: { id: string; crop?: { softness?: number } } }) => (
    <div data-testid={`shadow-video-${item.id}`} data-softness={item.crop?.softness ?? ''} />
  ),
}))

import { StableVideoSequence } from './stable-video-sequence'
import type { StableVideoSequenceItem } from './stable-video-sequence'
import { areGroupPropsEqual } from './stable-video-sequence-comparator'
import type { StableVideoGroup } from '../utils/video-scene'

const renderComparatorItem = (
  overrides: Partial<StableVideoSequenceItem> = {},
): StableVideoSequenceItem => ({
  id: 'clip-1',
  label: 'Clip 1',
  mediaId: 'media-1',
  originId: 'origin-1',
  type: 'video',
  trackId: 'track-1',
  from: 10,
  durationInFrames: 60,
  sourceStart: 5,
  sourceEnd: 65,
  sourceDuration: 120,
  sourceFps: 30,
  src: 'blob:video',
  audioSrc: 'blob:audio',
  speed: 1,
  zIndex: 1,
  muted: false,
  trackOrder: 0,
  trackVisible: true,
  ...overrides,
})

const renderComparatorGroup = (
  item: StableVideoSequenceItem = renderComparatorItem(),
  overrides: Partial<StableVideoGroup<StableVideoSequenceItem>> = {},
): StableVideoGroup<StableVideoSequenceItem> => ({
  originKey: 'media-1-origin-1-clip-1',
  minFrom: 10,
  maxEnd: 70,
  items: [item],
  ...overrides,
})

const comparatorProps = (
  group: StableVideoGroup<StableVideoSequenceItem>,
  renderItem = vi.fn(),
) => ({
  group,
  renderItem,
  transitionWindows: undefined,
})

describe('areGroupPropsEqual', () => {
  it.each([
    ['id', { id: 'clip-2' }],
    ['speed', { speed: 1.25 }],
    ['sourceStart', { sourceStart: 12 }],
    ['sourceEnd', { sourceEnd: 72 }],
    ['from', { from: 12 }],
    ['durationInFrames', { durationInFrames: 72 }],
    ['trackVisible', { trackVisible: false }],
    ['muted', { muted: true }],
    ['crop left', { crop: { left: 0.1 } }],
    ['crop right', { crop: { right: 0.1 } }],
    ['crop top', { crop: { top: 0.1 } }],
    ['crop bottom', { crop: { bottom: 0.1 } }],
    ['crop softness', { crop: { softness: 0.25 } }],
    [
      'cornerPin reference',
      {
        cornerPin: {
          topLeft: [0, 0] as [number, number],
          topRight: [1, 0] as [number, number],
          bottomRight: [1, 1] as [number, number],
          bottomLeft: [0, 1] as [number, number],
        },
      },
    ],
    ['blendMode', { blendMode: 'multiply' }],
    ['src', { src: 'blob:video-2' }],
    ['audioSrc', { audioSrc: 'blob:audio-2' }],
    ['reverseConformSrc', { reverseConformSrc: 'blob:reverse' }],
    ['reverseConformPreviewSrc', { reverseConformPreviewSrc: 'blob:reverse-preview' }],
    ['reverseConformStatus', { reverseConformStatus: 'ready' as const }],
    ['audioPitchSemitones', { audioPitchSemitones: 2 }],
    ['audioPitchCents', { audioPitchCents: 25 }],
    ['clip audio EQ', { audioEqEnabled: true, audioEqMidGainDb: 3 }],
    ['track audio EQ', { trackAudioEq: { enabled: true, midGainDb: 4 } }],
  ])('invalidates when the compared %s field changes', (_name, overrides) => {
    const renderItem = vi.fn()
    const prevProps = comparatorProps(renderComparatorGroup(), renderItem)
    const nextProps = comparatorProps(
      renderComparatorGroup(renderComparatorItem(overrides as Partial<StableVideoSequenceItem>)),
      renderItem,
    )

    expect(areGroupPropsEqual(prevProps, nextProps)).toBe(false)
  })

  it.each([
    ['same props references', comparatorProps(renderComparatorGroup())],
    ['same render-signature values in new references', comparatorProps(renderComparatorGroup())],
  ])('does not invalidate for %s', (_name, nextProps) => {
    const renderItem = vi.fn()
    const prevProps = comparatorProps(renderComparatorGroup(), renderItem)
    const stableNextProps =
      _name === 'same props references' ? prevProps : comparatorProps(nextProps.group, renderItem)

    expect(areGroupPropsEqual(prevProps, stableNextProps)).toBe(true)
  })

  it.each([
    ['renderItem callback', { renderItem: vi.fn() }],
    ['transition windows reference', { transitionWindows: [] }],
    ['originKey', { group: renderComparatorGroup(undefined, { originKey: 'other-origin' }) }],
    ['minFrom', { group: renderComparatorGroup(undefined, { minFrom: 9 }) }],
    ['maxEnd', { group: renderComparatorGroup(undefined, { maxEnd: 80 }) }],
    [
      'item count',
      {
        group: renderComparatorGroup(undefined, {
          items: [renderComparatorItem(), renderComparatorItem({ id: 'clip-2', from: 70 })],
        }),
      },
    ],
  ])('invalidates when %s changes', (_name, override) => {
    const renderItem = vi.fn()
    const prevProps = comparatorProps(renderComparatorGroup(), renderItem)
    const nextProps = {
      ...prevProps,
      ...override,
    }

    expect(areGroupPropsEqual(prevProps, nextProps)).toBe(false)
  })

  it.each([
    ['currentFrame', { currentFrame: 24 }],
    ['sequence frame offset', { _sequenceFrameOffset: 12 }],
    ['pool clip id', { _poolClipId: 'pool-2' }],
    ['transition sync marker', { _sharedTransitionSync: true }],
  ])(
    'characterizes %s as a frame-only/runtime-only field that does not invalidate',
    (_name, overrides) => {
      const renderItem = vi.fn()
      const prevProps = comparatorProps(renderComparatorGroup(), renderItem)
      const nextProps = comparatorProps(
        renderComparatorGroup(renderComparatorItem(overrides as Partial<StableVideoSequenceItem>)),
        renderItem,
      )

      expect(areGroupPropsEqual(prevProps, nextProps)).toBe(true)
    },
  )

  it.each([
    ['transform', { transform: { x: 10 } }],
    ['opacity', { opacity: 0.5 }],
    ['fit', { fit: 'cover' }],
    ['volume', { volume: -6 }],
    ['fadeIn', { fadeIn: 0.5 }],
    [
      'effects',
      { effects: [{ id: 'effect-1', type: 'gpu-effect', effectId: 'gpu-blur', params: {} }] },
    ],
    ['sourceFps', { sourceFps: 24 }],
    ['sourceDuration', { sourceDuration: 240 }],
    ['isReversed', { isReversed: true }],
    ['reverseConformPath', { reverseConformPath: '/cache/reverse.mp4' }],
  ])('documents current comparator gap: %s does not invalidate yet', (_name, overrides) => {
    const renderItem = vi.fn()
    const prevProps = comparatorProps(renderComparatorGroup(), renderItem)
    const nextProps = comparatorProps(
      renderComparatorGroup(renderComparatorItem(overrides as Partial<StableVideoSequenceItem>)),
      renderItem,
    )

    expect(areGroupPropsEqual(prevProps, nextProps)).toBe(true)
  })
})

describe('StableVideoSequence', () => {
  beforeEach(() => {
    ensureReadyLanesMock.mockClear()
    sequenceContextValue.localFrame = 28
  })

  it('uses a lightweight hidden bridge for shadow participants instead of renderItem', () => {
    const renderItem = vi.fn((item: { id: string }) => (
      <div data-testid={`render-${item.id}`}>{item.id}</div>
    ))

    render(
      <StableVideoSequence
        items={[
          {
            id: 'left',
            label: 'Left',
            mediaId: 'media-1',
            originId: 'origin-1',
            type: 'video',
            trackId: 'track-1',
            from: 0,
            durationInFrames: 60,
            src: 'blob:left',
            zIndex: 1,
            muted: false,
            trackOrder: 0,
            trackVisible: true,
          },
          {
            id: 'right',
            label: 'Right',
            mediaId: 'media-1',
            originId: 'origin-1',
            type: 'video',
            trackId: 'track-1',
            from: 30,
            durationInFrames: 60,
            src: 'blob:right',
            zIndex: 1,
            muted: false,
            trackOrder: 0,
            trackVisible: true,
          },
        ]}
        transitionWindows={[
          {
            startFrame: 30,
            endFrame: 50,
            durationInFrames: 20,
            leftClip: { id: 'left' },
            rightClip: { id: 'right' },
            leftPortion: 0.5,
            rightPortion: 0.5,
            cutPoint: 40,
            transition: {
              id: 'transition-1',
              leftClipId: 'left',
              rightClipId: 'right',
              timing: 'linear',
            },
          } as never,
        ]}
        renderItem={renderItem}
      />,
    )

    expect(screen.getByTestId('render-left')).toBeInTheDocument()
    expect(screen.getByTestId('shadow-video-right')).toBeInTheDocument()
    expect(screen.queryByTestId('render-right')).not.toBeInTheDocument()
    expect(renderItem).toHaveBeenCalledTimes(1)
    expect(renderItem).toHaveBeenCalledWith(expect.objectContaining({ id: 'left' }))
  })

  it('mounts same-origin shadow participants early enough before transition entry', () => {
    sequenceContextValue.localFrame = 22
    const renderItem = vi.fn((item: { id: string }) => (
      <div data-testid={`render-${item.id}`}>{item.id}</div>
    ))

    render(
      <StableVideoSequence
        items={[
          {
            id: 'left',
            label: 'Left',
            mediaId: 'media-1',
            originId: 'origin-1',
            type: 'video',
            trackId: 'track-1',
            from: 0,
            durationInFrames: 60,
            src: 'blob:left',
            zIndex: 1,
            muted: false,
            trackOrder: 0,
            trackVisible: true,
          },
          {
            id: 'right',
            label: 'Right',
            mediaId: 'media-1',
            originId: 'origin-1',
            type: 'video',
            trackId: 'track-1',
            from: 30,
            durationInFrames: 60,
            src: 'blob:right',
            zIndex: 1,
            muted: false,
            trackOrder: 0,
            trackVisible: true,
          },
        ]}
        transitionWindows={[
          {
            startFrame: 30,
            endFrame: 50,
            durationInFrames: 20,
            leftClip: { id: 'left' },
            rightClip: { id: 'right' },
            leftPortion: 0.5,
            rightPortion: 0.5,
            cutPoint: 40,
            transition: {
              id: 'transition-1',
              leftClipId: 'left',
              rightClipId: 'right',
              timing: 'linear',
            },
          } as never,
        ]}
        renderItem={renderItem}
      />,
    )

    expect(screen.getByTestId('render-left')).toBeInTheDocument()
    expect(screen.getByTestId('shadow-video-right')).toBeInTheDocument()
    expect(screen.queryByTestId('render-right')).not.toBeInTheDocument()
  })

  it('updates transition participant crop softness when the clip crop changes', () => {
    const renderItem = vi.fn((item: { id: string; crop?: { softness?: number } }) => (
      <div data-testid={`render-${item.id}`} data-softness={item.crop?.softness ?? ''}>
        {item.id}
      </div>
    ))

    const { rerender } = render(
      <StableVideoSequence
        items={[
          {
            id: 'left',
            label: 'Left',
            mediaId: 'media-1',
            originId: 'origin-1',
            type: 'video',
            trackId: 'track-1',
            from: 0,
            durationInFrames: 60,
            src: 'blob:left',
            crop: { left: 0.1, softness: 0.1 },
            zIndex: 1,
            muted: false,
            trackOrder: 0,
            trackVisible: true,
          },
          {
            id: 'right',
            label: 'Right',
            mediaId: 'media-1',
            originId: 'origin-1',
            type: 'video',
            trackId: 'track-1',
            from: 30,
            durationInFrames: 60,
            src: 'blob:right',
            crop: { right: 0.1, softness: 0.1 },
            zIndex: 1,
            muted: false,
            trackOrder: 0,
            trackVisible: true,
          },
        ]}
        transitionWindows={[
          {
            startFrame: 30,
            endFrame: 50,
            durationInFrames: 20,
            leftClip: { id: 'left' },
            rightClip: { id: 'right' },
            leftPortion: 0.5,
            rightPortion: 0.5,
            cutPoint: 40,
            transition: {
              id: 'transition-1',
              leftClipId: 'left',
              rightClipId: 'right',
              timing: 'linear',
            },
          } as never,
        ]}
        renderItem={renderItem}
      />,
    )

    expect(screen.getByTestId('render-left')).toHaveAttribute('data-softness', '0.1')
    expect(screen.getByTestId('shadow-video-right')).toHaveAttribute('data-softness', '0.1')

    rerender(
      <StableVideoSequence
        items={[
          {
            id: 'left',
            label: 'Left',
            mediaId: 'media-1',
            originId: 'origin-1',
            type: 'video',
            trackId: 'track-1',
            from: 0,
            durationInFrames: 60,
            src: 'blob:left',
            crop: { left: 0.1, softness: 0.25 },
            zIndex: 1,
            muted: false,
            trackOrder: 0,
            trackVisible: true,
          },
          {
            id: 'right',
            label: 'Right',
            mediaId: 'media-1',
            originId: 'origin-1',
            type: 'video',
            trackId: 'track-1',
            from: 30,
            durationInFrames: 60,
            src: 'blob:right',
            crop: { right: 0.1, softness: 0.25 },
            zIndex: 1,
            muted: false,
            trackOrder: 0,
            trackVisible: true,
          },
        ]}
        transitionWindows={[
          {
            startFrame: 30,
            endFrame: 50,
            durationInFrames: 20,
            leftClip: { id: 'left' },
            rightClip: { id: 'right' },
            leftPortion: 0.5,
            rightPortion: 0.5,
            cutPoint: 40,
            transition: {
              id: 'transition-1',
              leftClipId: 'left',
              rightClipId: 'right',
              timing: 'linear',
            },
          } as never,
        ]}
        renderItem={renderItem}
      />,
    )

    expect(screen.getByTestId('render-left')).toHaveAttribute('data-softness', '0.25')
    expect(screen.getByTestId('shadow-video-right')).toHaveAttribute('data-softness', '0.25')
  })
})
