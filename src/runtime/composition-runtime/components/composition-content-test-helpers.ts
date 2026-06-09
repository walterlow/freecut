import {
  useCompositionsStore,
  useGizmoStore,
  useTimelineStore,
} from '@/runtime/composition-runtime/deps/stores'
import type {
  AudioItem,
  CompositionItem,
  ShapeItem,
  TimelineItem,
  TimelineTrack,
  VideoItem,
} from '@/types/timeline'

export type TestSubComposition = ReturnType<
  typeof useCompositionsStore.getState
>['compositions'][number]

export function resetCompositionContentRuntimeState() {
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
}

export function makeNestedTimelineTrack(overrides: Partial<TimelineTrack> = {}): TimelineTrack {
  return {
    id: 'sub-track-video',
    name: 'V1',
    height: 60,
    locked: false,
    visible: true,
    muted: false,
    solo: false,
    order: 0,
    items: [],
    ...overrides,
  }
}

export function makeNestedVideoAudioTracks(): TimelineTrack[] {
  return [
    makeNestedTimelineTrack({ id: 'sub-track-video', name: 'V1', kind: 'video', order: 0 }),
    makeNestedTimelineTrack({ id: 'sub-track-audio', name: 'A1', kind: 'audio', order: 1 }),
  ]
}

export function makeNestedVideoItem(overrides: Partial<VideoItem> = {}): VideoItem {
  return {
    id: 'sub-video',
    type: 'video',
    trackId: 'sub-track-video',
    from: 0,
    durationInFrames: 60,
    label: 'Nested video',
    src: 'blob:video',
    mediaId: 'media-1',
    ...overrides,
  }
}

export function makeNestedAudioItem(overrides: Partial<AudioItem> = {}): AudioItem {
  return {
    id: 'sub-audio',
    type: 'audio',
    trackId: 'sub-track-audio',
    from: 0,
    durationInFrames: 60,
    label: 'Nested audio',
    src: 'blob:audio',
    mediaId: 'media-1',
    ...overrides,
  }
}

export function makeNestedShapeItem(overrides: Partial<ShapeItem> = {}): ShapeItem {
  return {
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
    ...overrides,
  }
}

export function makeTestSubComposition(
  overrides: Partial<TestSubComposition> & { id: string; name: string; items: TimelineItem[] },
): TestSubComposition {
  return {
    tracks: makeNestedVideoAudioTracks(),
    transitions: [],
    keyframes: [],
    fps: 30,
    width: 1280,
    height: 720,
    durationInFrames: 60,
    ...overrides,
  }
}

export function storeTestSubComposition(subComp: TestSubComposition) {
  useCompositionsStore.setState({
    compositions: [subComp],
    compositionById: { [subComp.id]: subComp },
    mediaDependencyIds: [],
    mediaDependencyVersion: 0,
  })
}

export function makeParentCompositionItem(
  overrides: Partial<CompositionItem> & { compositionId: string },
): CompositionItem {
  return {
    id: 'parent-comp-item',
    type: 'composition',
    trackId: 'parent-track',
    from: 0,
    durationInFrames: 60,
    label: 'Nested comp',
    compositionWidth: 1280,
    compositionHeight: 720,
    ...overrides,
  }
}
