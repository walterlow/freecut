import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { act, renderHook } from '@testing-library/react'
import type { TextItem, TimelineItem, VideoItem } from '@/types/timeline'
import type { Transition } from '@/types/transition'
import { makeTimelineAudioItem, makeTimelineTrack, makeTimelineVideoItem } from '../test-helpers'
import { resetPlaybackPreviewState } from '@/shared/state/playback-preview-test-helpers'
import { useSelectionStore } from '@/shared/state/selection'
import { useItemsStore } from '../stores/items-store'
import { useTransitionsStore } from '../stores/transitions-store'
import { useTimelineCommandStore } from '../stores/timeline-command-store'
import { useTimelineSettingsStore } from '../stores/timeline-settings-store'
import { useZoomStore } from '../stores/zoom-store'
import { useRollingEditPreviewStore } from '../stores/rolling-edit-preview-store'
import { useRippleEditPreviewStore } from '../stores/ripple-edit-preview-store'
import { useTransitionBreakPreviewStore } from '../stores/transition-break-preview-store'
import { useLinkedEditPreviewStore } from '../stores/linked-edit-preview-store'
import { useTimelineTrim } from './use-timeline-trim'

const TIMELINE_DURATION = 600
let rafCallbacks: FrameRequestCallback[] = []

/**
 * Zoom is pinned so 1 px == 1 frame: pixelsPerSecond 30 at 30 fps means
 * deltaFrames === deltaX in every gesture below.
 */
function setupStores() {
  useTimelineCommandStore.getState().clearHistory()
  useTimelineSettingsStore.setState({ fps: 30, isDirty: false, snapEnabled: false })
  useZoomStore.setState({ level: 0.3, pixelsPerSecond: 30 })
  useItemsStore
    .getState()
    .setTracks([
      makeTimelineTrack({ id: 'track-v1', name: 'V1', kind: 'video', order: 0 }),
      makeTimelineTrack({ id: 'track-v2', name: 'V2', kind: 'video', order: 1 }),
      makeTimelineTrack({ id: 'track-a1', name: 'A1', kind: 'audio', order: 2 }),
    ])
  useItemsStore.getState().setItems([])
  useTransitionsStore.getState().setTransitions([])
  useSelectionStore.getState().setDragState(null)
  useSelectionStore.getState().setActiveSnapTarget(null)
  useSelectionStore.getState().clearSelection()
  useRollingEditPreviewStore.getState().clearPreview()
  useRippleEditPreviewStore.getState().clearPreview()
  useTransitionBreakPreviewStore.getState().clearPreview()
  useLinkedEditPreviewStore.getState().clear()
  resetPlaybackPreviewState()
}

function makeFade(overrides: Partial<Transition> = {}): Transition {
  return {
    id: 'transition-1',
    type: 'crossfade',
    presentation: 'fade',
    timing: 'linear',
    leftClipId: 'left',
    rightClipId: 'right',
    trackId: 'track-v1',
    durationInFrames: 12,
    ...overrides,
  }
}

function getItem(id: string): TimelineItem {
  const item = useItemsStore.getState().itemById[id]
  expect(item).toBeDefined()
  return item as TimelineItem
}

function renderTrimHook(item: TimelineItem, trackLocked = false) {
  return renderHook(() => useTimelineTrim(item, TIMELINE_DURATION, trackLocked))
}

interface StartOptions {
  button?: number
  clientX?: number
  altKey?: boolean
  shiftKey?: boolean
  forcedMode?: 'rolling' | 'ripple' | null
  destroyTransitionAtHandle?: boolean
}

function startTrim(
  result: { current: ReturnType<typeof useTimelineTrim> },
  handle: 'start' | 'end',
  options: StartOptions = {},
) {
  const event = {
    button: options.button ?? 0,
    clientX: options.clientX ?? 0,
    altKey: options.altKey ?? false,
    shiftKey: options.shiftKey ?? false,
    stopPropagation: () => {},
    preventDefault: () => {},
  } as unknown as React.MouseEvent
  act(() => {
    result.current.handleTrimStart(event, handle, {
      forcedMode: options.forcedMode ?? null,
      destroyTransitionAtHandle: options.destroyTransitionAtHandle ?? false,
    })
  })
}

function holdKey(key: 'Alt' | 'Shift') {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key }))
  })
}

function moveMouse(clientX: number) {
  act(() => {
    window.dispatchEvent(new MouseEvent('mousemove', { clientX }))
    const callbacks = rafCallbacks
    rafCallbacks = []
    for (const callback of callbacks) callback(performance.now())
  })
}

function releaseMouse() {
  act(() => {
    window.dispatchEvent(new MouseEvent('mouseup'))
  })
}

describe('useTimelineTrim', () => {
  beforeEach(() => {
    rafCallbacks = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      rafCallbacks.push(callback)
      return rafCallbacks.length
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      rafCallbacks[id - 1] = () => {}
    })
    setupStores()
  })

  afterEach(() => vi.unstubAllGlobals())

  describe('normal trim', () => {
    it('extends the end handle and updates sourceEnd on commit', () => {
      const clip = makeTimelineVideoItem({ id: 'a' })
      useItemsStore.getState().setItems([clip])
      const { result } = renderTrimHook(clip)

      startTrim(result, 'end')
      moveMouse(30)
      expect(result.current.isTrimming).toBe(true)
      expect(result.current.trimDelta).toBe(30)
      releaseMouse()

      const updated = getItem('a')
      expect(updated.from).toBe(0)
      expect(updated.durationInFrames).toBe(90)
      expect(updated.sourceEnd).toBe(90)
      expect(result.current.isTrimming).toBe(false)
    })

    it('shrinks the start handle, shifting from and sourceStart', () => {
      const clip = makeTimelineVideoItem({ id: 'a' })
      useItemsStore.getState().setItems([clip])
      const { result } = renderTrimHook(clip)

      startTrim(result, 'start')
      moveMouse(20)
      releaseMouse()

      const updated = getItem('a')
      expect(updated.from).toBe(20)
      expect(updated.durationInFrames).toBe(40)
      expect(updated.sourceStart).toBe(20)
    })

    it('clamps end-handle extension at the source media limit', () => {
      // sourceDuration 120 — the clip can grow to at most 120 timeline frames
      const clip = makeTimelineVideoItem({ id: 'a' })
      useItemsStore.getState().setItems([clip])
      const { result } = renderTrimHook(clip)

      startTrim(result, 'end')
      moveMouse(100)
      expect(result.current.trimDelta).toBe(60)
      expect(result.current.trimConstrained).toBe(true)
      expect(result.current.trimConstraintLabel).toBe('no handle')
      releaseMouse()

      const updated = getItem('a')
      expect(updated.durationInFrames).toBe(120)
      expect(updated.sourceEnd).toBe(120)
    })

    it('clamps start-handle extension at sourceStart 0', () => {
      const clip = makeTimelineVideoItem({
        id: 'a',
        from: 50,
        sourceStart: 10,
        sourceEnd: 70,
      })
      useItemsStore.getState().setItems([clip])
      const { result } = renderTrimHook(clip)

      startTrim(result, 'start')
      moveMouse(-30)
      expect(result.current.trimDelta).toBe(-10)
      expect(result.current.trimConstrained).toBe(true)
      releaseMouse()

      const updated = getItem('a')
      expect(updated.from).toBe(40)
      expect(updated.durationInFrames).toBe(70)
      expect(updated.sourceStart).toBe(0)
    })

    it('never shrinks a clip below 1 frame', () => {
      const clip = makeTimelineVideoItem({ id: 'a' })
      useItemsStore.getState().setItems([clip])
      const { result } = renderTrimHook(clip)

      startTrim(result, 'end')
      moveMouse(-100)
      releaseMouse()

      expect(getItem('a').durationInFrames).toBe(1)
    })

    it('clamps end-handle extension against the next clip on the track', () => {
      const a = makeTimelineVideoItem({ id: 'a' })
      const b = makeTimelineVideoItem({ id: 'b', from: 80 })
      useItemsStore.getState().setItems([a, b])
      const { result } = renderTrimHook(a)

      startTrim(result, 'end')
      moveMouse(50)
      expect(result.current.trimDelta).toBe(20)
      expect(result.current.trimConstraintLabel).toBe('neighbor limit')
      releaseMouse()

      expect(getItem('a').durationInFrames).toBe(80)
      expect(getItem('b').from).toBe(80)
    })

    it('also trims the linked audio companion', () => {
      const video = makeTimelineVideoItem({ id: 'video-1', linkedGroupId: 'lg-1' })
      const audio = makeTimelineAudioItem({ id: 'audio-1', linkedGroupId: 'lg-1' })
      useItemsStore.getState().setItems([video, audio])
      const { result } = renderTrimHook(video)

      startTrim(result, 'end')
      moveMouse(-10)
      releaseMouse()

      expect(getItem('video-1').durationInFrames).toBe(50)
      expect(getItem('audio-1').durationInFrames).toBe(50)
    })

    it('trims a mixed text and linked A/V selection as one undoable group', () => {
      const text: TextItem = {
        id: 'text-1',
        type: 'text',
        trackId: 'track-v2',
        from: 0,
        durationInFrames: 60,
        label: 'CINEMA',
        text: 'CINEMA',
        color: '#ffffff',
      }
      const video = makeTimelineVideoItem({ id: 'video-1', linkedGroupId: 'lg-1' })
      const audio = makeTimelineAudioItem({ id: 'audio-1', linkedGroupId: 'lg-1' })
      useItemsStore.getState().setItems([text, video, audio])
      useSelectionStore.getState().selectItems(['text-1', 'video-1', 'audio-1'])
      const undoDepthBefore = useTimelineCommandStore.getState().undoStack.length
      const { result } = renderTrimHook(text)

      startTrim(result, 'end')
      moveMouse(-10)

      expect(useSelectionStore.getState().dragState?.draggedItemIds).toEqual(['text-1'])
      const previewUpdates = useLinkedEditPreviewStore.getState().updatesById
      expect(previewUpdates['video-1']?.durationInFrames).toBe(50)
      expect(previewUpdates['audio-1']?.durationInFrames).toBe(50)

      releaseMouse()

      expect(getItem('text-1').durationInFrames).toBe(50)
      expect(getItem('video-1').durationInFrames).toBe(50)
      expect(getItem('audio-1').durationInFrames).toBe(50)
      expect(useTimelineCommandStore.getState().undoStack.length).toBe(undoDepthBefore + 1)

      act(() => {
        useTimelineCommandStore.getState().undo()
      })
      expect(getItem('text-1').durationInFrames).toBe(60)
      expect(getItem('video-1').durationInFrames).toBe(60)
      expect(getItem('audio-1').durationInFrames).toBe(60)
    })

    it('excludes horizontally selected clips that do not share the trim edge', () => {
      const text: TextItem = {
        id: 'text-1',
        type: 'text',
        trackId: 'track-v2',
        from: 120,
        durationInFrames: 60,
        label: 'CINEMA',
        text: 'CINEMA',
        color: '#ffffff',
      }
      const alignedVideo = makeTimelineVideoItem({
        id: 'video-aligned',
        linkedGroupId: 'lg-aligned',
        from: 100,
        durationInFrames: 80,
      })
      const alignedAudio = makeTimelineAudioItem({
        id: 'audio-aligned',
        linkedGroupId: 'lg-aligned',
        from: 100,
        durationInFrames: 80,
      })
      const earlierVideo = makeTimelineVideoItem({
        id: 'video-earlier',
        linkedGroupId: 'lg-earlier',
        from: 40,
        durationInFrames: 60,
      })
      const earlierAudio = makeTimelineAudioItem({
        id: 'audio-earlier',
        linkedGroupId: 'lg-earlier',
        from: 40,
        durationInFrames: 60,
      })
      useItemsStore
        .getState()
        .setItems([text, alignedVideo, alignedAudio, earlierVideo, earlierAudio])
      useSelectionStore
        .getState()
        .selectItems(['text-1', 'video-aligned', 'audio-aligned', 'video-earlier', 'audio-earlier'])
      const { result } = renderTrimHook(text)

      startTrim(result, 'end')
      moveMouse(-10)

      const previewUpdates = useLinkedEditPreviewStore.getState().updatesById
      expect(previewUpdates['video-aligned']?.durationInFrames).toBe(70)
      expect(previewUpdates['audio-aligned']?.durationInFrames).toBe(70)
      expect(previewUpdates['video-earlier']).toBeUndefined()
      expect(previewUpdates['audio-earlier']).toBeUndefined()

      releaseMouse()

      expect(getItem('text-1').durationInFrames).toBe(50)
      expect(getItem('video-aligned').durationInFrames).toBe(70)
      expect(getItem('audio-aligned').durationInFrames).toBe(70)
      expect(getItem('video-earlier').durationInFrames).toBe(60)
      expect(getItem('audio-earlier').durationInFrames).toBe(60)
    })

    it('uses the shared start edge instead of an adjacent selected clip end', () => {
      const text: TextItem = {
        id: 'text-1',
        type: 'text',
        trackId: 'track-v2',
        from: 100,
        durationInFrames: 60,
        label: 'CINEMA',
        text: 'CINEMA',
        color: '#ffffff',
      }
      const alignedVideo = makeTimelineVideoItem({
        id: 'video-aligned',
        linkedGroupId: 'lg-aligned',
        from: 100,
        durationInFrames: 80,
      })
      const alignedAudio = makeTimelineAudioItem({
        id: 'audio-aligned',
        linkedGroupId: 'lg-aligned',
        from: 100,
        durationInFrames: 80,
      })
      const earlierVideo = makeTimelineVideoItem({
        id: 'video-earlier',
        linkedGroupId: 'lg-earlier',
        from: 40,
        durationInFrames: 60,
      })
      const earlierAudio = makeTimelineAudioItem({
        id: 'audio-earlier',
        linkedGroupId: 'lg-earlier',
        from: 40,
        durationInFrames: 60,
      })
      useItemsStore
        .getState()
        .setItems([text, alignedVideo, alignedAudio, earlierVideo, earlierAudio])
      useSelectionStore
        .getState()
        .selectItems(['text-1', 'video-aligned', 'audio-aligned', 'video-earlier', 'audio-earlier'])
      const { result } = renderTrimHook(text)

      startTrim(result, 'start')
      moveMouse(10)

      const previewUpdates = useLinkedEditPreviewStore.getState().updatesById
      expect(previewUpdates['video-aligned']).toMatchObject({
        from: 110,
        durationInFrames: 70,
      })
      expect(previewUpdates['audio-aligned']).toMatchObject({
        from: 110,
        durationInFrames: 70,
      })
      expect(previewUpdates['video-earlier']).toBeUndefined()
      expect(previewUpdates['audio-earlier']).toBeUndefined()

      releaseMouse()

      expect(getItem('text-1')).toMatchObject({ from: 110, durationInFrames: 50 })
      expect(getItem('video-aligned')).toMatchObject({ from: 110, durationInFrames: 70 })
      expect(getItem('audio-aligned')).toMatchObject({ from: 110, durationInFrames: 70 })
      expect(getItem('video-earlier')).toMatchObject({ from: 40, durationInFrames: 60 })
      expect(getItem('audio-earlier')).toMatchObject({ from: 40, durationInFrames: 60 })
    })

    it('does not group a selected edge that is one frame away', () => {
      const text: TextItem = {
        id: 'text-1',
        type: 'text',
        trackId: 'track-v2',
        from: 120,
        durationInFrames: 60,
        label: 'CINEMA',
        text: 'CINEMA',
        color: '#ffffff',
      }
      const nearVideo = makeTimelineVideoItem({
        id: 'video-near',
        from: 119,
        durationInFrames: 60,
      })
      useItemsStore.getState().setItems([text, nearVideo])
      useSelectionStore.getState().selectItems(['text-1', 'video-near'])
      const { result } = renderTrimHook(text)

      startTrim(result, 'end')
      moveMouse(-10)

      expect(useLinkedEditPreviewStore.getState().updatesById['video-near']).toBeUndefined()

      releaseMouse()

      expect(getItem('text-1').durationInFrames).toBe(50)
      expect(getItem('video-near').durationInFrames).toBe(60)
    })

    it('leaves a vertically aligned selected companion unchanged on a locked track', () => {
      const text: TextItem = {
        id: 'text-1',
        type: 'text',
        trackId: 'track-v2',
        from: 0,
        durationInFrames: 60,
        label: 'CINEMA',
        text: 'CINEMA',
        color: '#ffffff',
      }
      const video = makeTimelineVideoItem({ id: 'video-1', linkedGroupId: 'lg-1' })
      const audio = makeTimelineAudioItem({ id: 'audio-1', linkedGroupId: 'lg-1' })
      useItemsStore.getState().setTracks([
        makeTimelineTrack({ id: 'track-v1', name: 'V1', kind: 'video', order: 0 }),
        makeTimelineTrack({ id: 'track-v2', name: 'V2', kind: 'video', order: 1 }),
        makeTimelineTrack({
          id: 'track-a1',
          name: 'A1',
          kind: 'audio',
          order: 2,
          locked: true,
        }),
      ])
      useItemsStore.getState().setItems([text, video, audio])
      useSelectionStore.getState().selectItems(['text-1', 'video-1', 'audio-1'])
      const { result } = renderTrimHook(text)

      startTrim(result, 'end')
      moveMouse(-10)

      const previewUpdates = useLinkedEditPreviewStore.getState().updatesById
      expect(previewUpdates['video-1']?.durationInFrames).toBe(50)
      expect(previewUpdates['audio-1']).toBeUndefined()

      releaseMouse()

      expect(getItem('text-1').durationInFrames).toBe(50)
      expect(getItem('video-1').durationInFrames).toBe(50)
      expect(getItem('audio-1').durationInFrames).toBe(60)
    })

    it('uses the tightest neighbor clamp across the vertical trim group', () => {
      const text: TextItem = {
        id: 'text-1',
        type: 'text',
        trackId: 'track-v2',
        from: 0,
        durationInFrames: 60,
        label: 'CINEMA',
        text: 'CINEMA',
        color: '#ffffff',
      }
      const video = makeTimelineVideoItem({ id: 'video-1', linkedGroupId: 'lg-1' })
      const audio = makeTimelineAudioItem({ id: 'audio-1', linkedGroupId: 'lg-1' })
      const audioNeighbor = makeTimelineAudioItem({
        id: 'audio-neighbor',
        mediaId: 'media-2',
        from: 65,
        durationInFrames: 30,
      })
      useItemsStore.getState().setItems([text, video, audio, audioNeighbor])
      useSelectionStore.getState().selectItems(['text-1', 'video-1', 'audio-1'])
      const { result } = renderTrimHook(text)

      startTrim(result, 'end')
      moveMouse(20)

      expect(result.current.trimDelta).toBe(5)
      expect(result.current.trimConstraintLabel).toBe('neighbor limit')
      expect(useLinkedEditPreviewStore.getState().updatesById['video-1']?.durationInFrames).toBe(65)
      expect(useLinkedEditPreviewStore.getState().updatesById['audio-1']?.durationInFrames).toBe(65)

      releaseMouse()

      expect(getItem('text-1').durationInFrames).toBe(65)
      expect(getItem('video-1').durationInFrames).toBe(65)
      expect(getItem('audio-1').durationInFrames).toBe(65)
      expect(getItem('audio-neighbor').from).toBe(65)
    })
  })

  describe('ripple edit', () => {
    it('shrinking the end shifts downstream clips left (Shift modifier)', () => {
      const a = makeTimelineVideoItem({ id: 'a' })
      const b = makeTimelineVideoItem({ id: 'b', from: 80 })
      useItemsStore.getState().setItems([a, b])
      const { result } = renderTrimHook(a)

      startTrim(result, 'end', { shiftKey: true })
      holdKey('Shift')
      moveMouse(-20)
      expect(result.current.isRippleEdit).toBe(true)
      releaseMouse()

      expect(getItem('a').durationInFrames).toBe(40)
      expect(getItem('b').from).toBe(60)
    })

    it('shrinking the start anchors from and pulls downstream clips left (forced mode)', () => {
      const a = makeTimelineVideoItem({ id: 'a' })
      const b = makeTimelineVideoItem({ id: 'b', from: 80 })
      useItemsStore.getState().setItems([a, b])
      const { result } = renderTrimHook(a)

      startTrim(result, 'start', { forcedMode: 'ripple' })
      moveMouse(20)
      releaseMouse()

      const trimmed = getItem('a')
      // Anchor-from model: the clip keeps its position, content shifts
      expect(trimmed.from).toBe(0)
      expect(trimmed.durationInFrames).toBe(40)
      expect(trimmed.sourceStart).toBe(20)
      expect(getItem('b').from).toBe(60)
    })
  })

  describe('rolling edit', () => {
    it('moves the edit point between two adjacent clips (Alt modifier)', () => {
      const a = makeTimelineVideoItem({ id: 'a' })
      const b = makeTimelineVideoItem({ id: 'b', from: 60 })
      useItemsStore.getState().setItems([a, b])
      const { result } = renderTrimHook(a)

      startTrim(result, 'end', { altKey: true })
      holdKey('Alt')
      moveMouse(20)
      expect(result.current.isRollingEdit).toBe(true)
      releaseMouse()

      const left = getItem('a')
      const right = getItem('b')
      expect(left.durationInFrames).toBe(80)
      expect(right.from).toBe(80)
      expect(right.durationInFrames).toBe(40)
      expect(right.sourceStart).toBe(20)
      // Total duration unchanged
      expect(right.from + right.durationInFrames).toBe(120)
    })

    it('refuses to start a rolling edit with no neighbor at the edge', () => {
      const a = makeTimelineVideoItem({ id: 'a' })
      useItemsStore.getState().setItems([a])
      const { result } = renderTrimHook(a)

      startTrim(result, 'end', { altKey: true })

      expect(result.current.isTrimming).toBe(false)
      moveMouse(20)
      releaseMouse()
      expect(getItem('a').durationInFrames).toBe(60)
    })
  })

  describe('transition handling', () => {
    it('removes the transition at the handle when destroyTransitionAtHandle is set', () => {
      const a = makeTimelineVideoItem({ id: 'a' })
      const b = makeTimelineVideoItem({ id: 'b', from: 60 })
      useItemsStore.getState().setItems([a, b])
      useTransitionsStore
        .getState()
        .setTransitions([makeFade({ leftClipId: 'a', rightClipId: 'b' })])
      const { result } = renderTrimHook(a)

      startTrim(result, 'end', { destroyTransitionAtHandle: true })
      moveMouse(-10)
      releaseMouse()

      expect(useTransitionsStore.getState().transitions).toHaveLength(0)
      expect(getItem('a').durationInFrames).toBe(50)
    })
  })

  describe('snapping', () => {
    it('snaps the dragged edge to a clip edge on another track', () => {
      useTimelineSettingsStore.setState({ snapEnabled: true })
      const a = makeTimelineVideoItem({ id: 'a' })
      const c = makeTimelineVideoItem({ id: 'c', trackId: 'track-v2', from: 93 })
      useItemsStore.getState().setItems([a, c])
      const { result } = renderTrimHook(a)

      startTrim(result, 'end')
      // Unsnapped target edge would be 94; clip c's start edge at 93 is closer
      // than any grid line, so the edge snaps there.
      moveMouse(34)
      expect(result.current.trimDelta).toBe(33)
      releaseMouse()

      expect(getItem('a').durationInFrames).toBe(93)
    })
  })

  describe('guards', () => {
    it('ignores trim start on a locked track', () => {
      const clip = makeTimelineVideoItem({ id: 'a' })
      useItemsStore.getState().setItems([clip])
      const { result } = renderTrimHook(clip, true)

      startTrim(result, 'end')
      expect(result.current.isTrimming).toBe(false)
      moveMouse(30)
      releaseMouse()
      expect(getItem('a').durationInFrames).toBe(60)
    })

    it('ignores non-left mouse buttons', () => {
      const clip = makeTimelineVideoItem({ id: 'a' })
      useItemsStore.getState().setItems([clip])
      const { result } = renderTrimHook(clip)

      startTrim(result, 'end', { button: 2 })
      expect(result.current.isTrimming).toBe(false)
    })

    it('commits nothing when the mouse never moved', () => {
      const clip = makeTimelineVideoItem({ id: 'a' })
      useItemsStore.getState().setItems([clip])
      const { result } = renderTrimHook(clip)
      const undoDepthBefore = useTimelineCommandStore.getState().undoStack.length

      startTrim(result, 'end')
      releaseMouse()

      expect(getItem('a').durationInFrames).toBe(60)
      expect(useTimelineCommandStore.getState().undoStack.length).toBe(undoDepthBefore)
    })
  })

  describe('undo integration', () => {
    it('a full trim gesture produces a single undo entry that restores the clip', () => {
      const clip = makeTimelineVideoItem({ id: 'a' })
      useItemsStore.getState().setItems([clip])
      const { result } = renderTrimHook(clip)
      const undoDepthBefore = useTimelineCommandStore.getState().undoStack.length

      startTrim(result, 'end')
      moveMouse(10)
      moveMouse(20)
      moveMouse(30)
      releaseMouse()

      expect(getItem('a').durationInFrames).toBe(90)
      expect(useTimelineCommandStore.getState().undoStack.length).toBe(undoDepthBefore + 1)

      act(() => {
        useTimelineCommandStore.getState().undo()
      })
      const restored = getItem('a') as VideoItem
      expect(restored.durationInFrames).toBe(60)
      expect(restored.sourceEnd).toBe(60)
    })
  })
})
