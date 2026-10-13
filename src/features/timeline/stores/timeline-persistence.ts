import type { LoadTimelineOptions } from '../types'
import {
  cloneVectorKeyframe,
  getDirectPropertyLinks,
  getPropertyExpressions,
  type ItemKeyframes,
} from '@/types/keyframe'
import type {
  AudioItem,
  CompositionItem,
  ProjectMarker,
  TimelineItem,
  TimelineTrack,
} from '@/types/timeline'
import type { AudioEqSettings } from '@/types/audio'
import type { Transition } from '@/types/transition'
import type { CompositionEditorKind, ProjectTimeline, Project } from '@/types/project'

import { createLogger, createOperationId } from '@/shared/logging/logger'
import { usePreviewBridgeStore } from '@/shared/state/preview-bridge'
import { usePlaybackStore } from '@/shared/state/playback'
import { DEFAULT_TRACK_HEIGHT } from '../constants'
import { DEFAULT_PROJECT_HEIGHT, DEFAULT_PROJECT_WIDTH } from '@/shared/projects/defaults'
import {
  createClassicTrack,
  createDefaultClassicTracks,
  findNearestTrackByKind,
  getAdjacentTrackOrder,
  getTrackKind,
} from '../utils/classic-tracks'
import { loadTrackHeightOverrides } from '../utils/track-heights'
import { timelineToSourceFrames } from '../utils/source-calculations'
import { useZoomStore } from './zoom-store'
import { useItemsStore } from './items-store'
import { useTransitionsStore } from './transitions-store'
import { useKeyframesStore } from './keyframes-store'
import { useMarkersStore } from './markers-store'
import { useTimelineSettingsStore } from './timeline-settings-store'
import { ROOT_HISTORY_CONTEXT, useTimelineCommandStore } from './timeline-command-store'
import { useCompositionsStore, type SubComposition } from './compositions-store'
import { getActiveTabId, useCompositionNavigationStore } from './composition-navigation-store'
import { useSequencesStore } from './sequences-store'
import { getProject, updateProject, saveProjectThumbnail } from '@/infrastructure/storage'
import {
  importCanvasRenderOrchestrator,
  convertTimelineToComposition,
} from '@/features/timeline/deps/export-contract'
import { resolveMediaUrls } from '@/features/timeline/deps/media-library-resolver'
import { importMediaLibraryService } from '@/features/timeline/deps/media-library-service'
import { validateProjectMediaReferences } from '@/features/timeline/utils/media-validation'
import { useMediaLibraryStore } from '@/features/timeline/deps/media-library-store'
import { useSettingsStore } from '@/features/timeline/deps/settings-contract'
import { migrateProject, CURRENT_SCHEMA_VERSION } from '@/shared/projects/migrations'
import {
  needsLegacyAvTrackLayoutRepair,
  repairLegacyAvTrackLayout,
} from '@/features/timeline/utils/legacy-av-track-repair'
import { splitUnpairedVideoAudio } from '@/features/timeline/utils/embedded-audio-split'
import { getCompositionOwnedAudioSources } from '@/features/timeline/utils/composition-clip-summary'
import {
  getLinkedCompositionAudioCompanion,
  isCompositionAudioItem,
} from '@/shared/utils/linked-media'
import { getEffectiveTimelineMaxFrame, sanitizeInOutPoints } from '../utils/in-out-points'
import { reverseConformService } from '../services/reverse-conform-service'
import {
  getCurrentTimelineSnapshot,
  getEffectiveCompositions,
  getRootTimelineSnapshot,
  type TimelineSnapshotLike,
} from './actions/shared'

const logger = createLogger('TimelineStore')

/**
 * Progressive downscale a canvas to a JPEG blob.
 * Halves dimensions repeatedly to avoid aliasing with high-frequency effects.
 */
async function scaleCanvasToBlob(
  source: OffscreenCanvas | HTMLCanvasElement,
  targetW: number,
  targetH: number,
  quality: number,
): Promise<Blob> {
  let srcW = source.width
  let srcH = source.height
  let current: OffscreenCanvas | HTMLCanvasElement = source

  while (srcW > targetW * 2 || srcH > targetH * 2) {
    const nextW = Math.max(Math.ceil(srcW / 2), targetW)
    const nextH = Math.max(Math.ceil(srcH / 2), targetH)
    const step = new OffscreenCanvas(nextW, nextH)
    const ctx = step.getContext('2d')!
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(current, 0, 0, nextW, nextH)
    current = step
    srcW = nextW
    srcH = nextH
  }

  const out = new OffscreenCanvas(targetW, targetH)
  const outCtx = out.getContext('2d')!
  outCtx.imageSmoothingQuality = 'high'
  outCtx.drawImage(current, 0, 0, targetW, targetH)
  return out.convertToBlob({ type: 'image/jpeg', quality })
}

function collectVideoMediaIds(project: Project): string[] {
  const mediaIds = new Set<string>()
  const timeline = project.timeline
  if (!timeline) return []

  for (const item of timeline.items ?? []) {
    if (item.type === 'video' && item.mediaId) {
      mediaIds.add(item.mediaId)
    }
  }

  for (const composition of timeline.compositions ?? []) {
    for (const item of composition.items ?? []) {
      if (item.type === 'video' && item.mediaId) {
        mediaIds.add(item.mediaId)
      }
    }
  }

  return [...mediaIds]
}

function cloneTransitionForProject(transition: Transition): Transition {
  return {
    ...transition,
    ...(transition.bezierPoints && { bezierPoints: { ...transition.bezierPoints } }),
    ...(transition.properties && { properties: { ...transition.properties } }),
  }
}

/**
 * Strip ephemeral (never-persist) fields from a timeline item:
 *  - `thumbnailUrl` — a transient object URL for the clip thumbnail.
 *  - `src` / `audioSrc` when they are `blob:` URLs on a media-backed item.
 *    Blob URLs are session-scoped: persisting one bakes a dead URL into the
 *    project file that fails to `fetch()` on the next load (the recurring
 *    `net::ERR_FILE_NOT_FOUND` from dotlottie/video). Media-backed items
 *    re-resolve their src from `mediaId` on load, so the stored value is
 *    redundant anyway — drop it.
 *
 * Returns the SAME reference when nothing changed so callers can detect a
 * mutation by identity.
 */
function stripTimelineItemEphemeralFields<
  T extends { thumbnailUrl?: string; mediaId?: string; src?: string; audioSrc?: string },
>(item: T): T {
  let next = item

  if (next.thumbnailUrl !== undefined) {
    const rest = { ...next }
    delete rest.thumbnailUrl
    next = rest as T
  }

  if (next.mediaId && typeof next.src === 'string' && next.src.startsWith('blob:')) {
    next = { ...next, src: '' }
  }

  if (next.mediaId && typeof next.audioSrc === 'string' && next.audioSrc.startsWith('blob:')) {
    next = { ...next, audioSrc: '' }
  }

  return next
}

function sanitizeTimelineEphemeralFields(timeline: ProjectTimeline): {
  timeline: ProjectTimeline
  cleaned: boolean
} {
  let cleaned = false

  const items = (timeline.items ?? []).map((item) => {
    const stripped = stripTimelineItemEphemeralFields(item)
    if (stripped !== item) {
      cleaned = true
    }
    return stripped
  }) as ProjectTimeline['items']

  const compositions = timeline.compositions?.map((composition) => {
    let compositionCleaned = false

    const nextItems = (composition.items ?? []).map((item) => {
      const stripped = stripTimelineItemEphemeralFields(item)
      if (stripped !== item) {
        cleaned = true
        compositionCleaned = true
      }
      return stripped
    }) as ProjectTimeline['items']

    if (!compositionCleaned) {
      return composition
    }

    return {
      ...composition,
      items: nextItems,
    }
  }) as ProjectTimeline['compositions']

  if (!cleaned) {
    return { timeline, cleaned: false }
  }

  return {
    timeline: {
      ...timeline,
      items,
      ...(compositions && { compositions }),
    },
    cleaned: true,
  }
}

async function buildVideoHasAudioMap(
  mediaIds: string[],
): Promise<Record<string, boolean | undefined>> {
  const mediaById = useMediaLibraryStore.getState().mediaById
  const missingMediaIds = mediaIds.filter((mediaId) => !mediaById[mediaId])
  const mediaLibraryModule = missingMediaIds.length > 0 ? await importMediaLibraryService() : null
  const entries = await Promise.all(
    mediaIds.map(async (mediaId) => {
      const cachedMedia = mediaById[mediaId]
      if (cachedMedia) {
        return [mediaId, !!cachedMedia.audioCodec] as const
      }

      const media = await mediaLibraryModule?.mediaLibraryService.getMedia(mediaId)
      return [mediaId, !!media?.audioCodec] as const
    }),
  )

  return Object.fromEntries(entries)
}

function normalizeCompoundWrapperSourceFields(params: {
  item: CompositionItem | (AudioItem & { compositionId: string })
  compositionFps: number
  timelineFps: number
  fallbackDurationInFrames: number
}) {
  const { item, compositionFps, timelineFps, fallbackDurationInFrames } = params
  const sourceFps = item.sourceFps ?? compositionFps
  const speed = item.speed ?? 1
  const sourceStart = item.sourceStart ?? 0
  const inferredSourceDuration = timelineToSourceFrames(
    item.durationInFrames || fallbackDurationInFrames,
    speed,
    timelineFps,
    sourceFps,
  )

  return {
    sourceStart,
    sourceEnd: item.sourceEnd ?? sourceStart + inferredSourceDuration,
    sourceDuration: item.sourceDuration ?? inferredSourceDuration,
    sourceFps,
    speed,
  }
}

function hasCompositionVisualItems(items: TimelineItem[]): boolean {
  return items.some((item) => item.type !== 'audio')
}

function cleanupRedundantEmptyClassicAudioTracks(project: Project): {
  project: Project
  cleaned: boolean
} {
  if (!project.timeline?.tracks?.length) {
    return { project, cleaned: false }
  }

  const itemsByTrackId = new Map<string, number>()
  for (const item of project.timeline.items ?? []) {
    itemsByTrackId.set(item.trackId, (itemsByTrackId.get(item.trackId) ?? 0) + 1)
  }

  const classicAudioTracks = (project.timeline.tracks as TimelineTrack[])
    .map((track) => {
      const match = track.name.match(/^A(\d+)$/i)
      return match ? { track, number: Number.parseInt(match[1]!, 10) } : null
    })
    .filter((entry): entry is { track: TimelineTrack; number: number } => !!entry)
    .filter(({ track, number }) => getTrackKind(track) === 'audio' && Number.isFinite(number))

  const highestOccupiedClassicAudioNumber = classicAudioTracks.reduce(
    (highest, { track, number }) => {
      return (itemsByTrackId.get(track.id) ?? 0) > 0 ? Math.max(highest, number) : highest
    },
    0,
  )

  if (highestOccupiedClassicAudioNumber <= 0) {
    return { project, cleaned: false }
  }

  const removableTrackIds = new Set(
    classicAudioTracks
      .filter(
        ({ track, number }) =>
          number > highestOccupiedClassicAudioNumber && (itemsByTrackId.get(track.id) ?? 0) === 0,
      )
      .map(({ track }) => track.id),
  )

  if (removableTrackIds.size === 0) {
    return { project, cleaned: false }
  }

  return {
    cleaned: true,
    project: {
      ...project,
      timeline: {
        ...project.timeline,
        tracks: project.timeline.tracks.filter((track) => !removableTrackIds.has(track.id)),
      },
    },
  }
}

function repairCompoundClipWrappers(project: Project): { project: Project; repaired: boolean } {
  if (
    !project.timeline?.tracks ||
    !project.timeline.items ||
    !project.timeline.compositions?.length
  ) {
    return { project, repaired: false }
  }

  let tracks = project.timeline.tracks.map((track) => ({ ...track })) as TimelineTrack[]
  const items = project.timeline.items.map((item) => ({ ...item })) as TimelineItem[]
  const compositionsById = new Map(
    (project.timeline.compositions ?? []).map((composition) => [composition.id, composition]),
  )
  const timelineFps = project.metadata?.fps ?? 30
  let changed = false

  const ensureTrackOfKindNear = (
    baseTrackId: string,
    kind: 'video' | 'audio',
    direction: 'above' | 'below',
  ): string => {
    const baseTrack = tracks.find((track) => track.id === baseTrackId) ?? null
    if (!baseTrack) return baseTrackId

    const nearestTrack = findNearestTrackByKind({
      tracks,
      targetTrack: baseTrack,
      kind,
      direction,
    })
    if (nearestTrack) return nearestTrack.id

    const createdTrack = createClassicTrack({
      tracks,
      kind,
      order: getAdjacentTrackOrder(tracks, baseTrack, direction),
      height: baseTrack.height ?? DEFAULT_TRACK_HEIGHT,
    })
    tracks = [...tracks, createdTrack]
    changed = true
    return createdTrack.id
  }

  const compositionWrappers = items.filter(
    (item): item is CompositionItem => item.type === 'composition',
  )
  for (const wrapper of compositionWrappers) {
    const composition = compositionsById.get(wrapper.compositionId)
    if (!composition) continue

    const wrapperIndex = items.findIndex((item) => item.id === wrapper.id)
    if (wrapperIndex === -1) continue

    const hasVisualWrapper = hasCompositionVisualItems(composition.items as TimelineItem[])
    const hasOwnedAudio =
      getCompositionOwnedAudioSources({
        items: composition.items as TimelineItem[],
        tracks: composition.tracks as TimelineTrack[],
        fps: composition.fps,
      }).length > 0
    const wrapperTrack = tracks.find((track) => track.id === wrapper.trackId) ?? null
    const wrapperTrackKind = wrapperTrack ? getTrackKind(wrapperTrack) : null
    const existingAudioCompanion =
      getLinkedCompositionAudioCompanion(items, wrapper) ??
      items.find(
        (item): item is AudioItem & { compositionId: string } =>
          item.id !== wrapper.id &&
          isCompositionAudioItem(item) &&
          item.compositionId === wrapper.compositionId,
      ) ??
      null
    const sourceFields = normalizeCompoundWrapperSourceFields({
      item: wrapper,
      compositionFps: composition.fps,
      timelineFps,
      fallbackDurationInFrames: composition.durationInFrames,
    })

    if (!hasVisualWrapper && hasOwnedAudio) {
      const audioTrackId =
        wrapperTrackKind === 'audio'
          ? wrapper.trackId
          : existingAudioCompanion?.trackId
            ? existingAudioCompanion.trackId
            : ensureTrackOfKindNear(wrapper.trackId, 'audio', 'below')
      items[wrapperIndex] = {
        ...wrapper,
        type: 'audio',
        trackId: audioTrackId,
        src: '',
        ...sourceFields,
      } as AudioItem
      // Remove the existing audio companion to avoid a duplicate overlapping audio item
      if (existingAudioCompanion) {
        const companionIndex = items.findIndex((i) => i.id === existingAudioCompanion.id)
        if (companionIndex !== -1) {
          items.splice(companionIndex, 1)
        }
      }
      changed = true
      continue
    }

    const visualTrackId =
      hasVisualWrapper && wrapperTrackKind === 'audio'
        ? ensureTrackOfKindNear(wrapper.trackId, 'video', 'above')
        : wrapper.trackId
    const audioTrackId = hasOwnedAudio
      ? (existingAudioCompanion?.trackId ??
        (wrapperTrackKind === 'audio'
          ? wrapper.trackId
          : ensureTrackOfKindNear(visualTrackId, 'audio', 'below')))
      : null
    const linkedGroupId = hasOwnedAudio
      ? (existingAudioCompanion?.linkedGroupId ?? wrapper.linkedGroupId ?? crypto.randomUUID())
      : wrapper.linkedGroupId

    const nextWrapper: CompositionItem = {
      ...wrapper,
      trackId: visualTrackId,
      linkedGroupId,
      ...sourceFields,
    }
    items[wrapperIndex] = nextWrapper
    if (
      nextWrapper.trackId !== wrapper.trackId ||
      nextWrapper.linkedGroupId !== wrapper.linkedGroupId ||
      nextWrapper.sourceStart !== wrapper.sourceStart ||
      nextWrapper.sourceEnd !== wrapper.sourceEnd ||
      nextWrapper.sourceDuration !== wrapper.sourceDuration ||
      nextWrapper.sourceFps !== wrapper.sourceFps ||
      nextWrapper.speed !== wrapper.speed
    ) {
      changed = true
    }

    const companionIndex = items.findIndex(
      (item) =>
        item.id !== nextWrapper.id &&
        isCompositionAudioItem(item) &&
        item.compositionId === nextWrapper.compositionId &&
        (!linkedGroupId ||
          item.linkedGroupId === linkedGroupId ||
          item.linkedGroupId === existingAudioCompanion?.linkedGroupId),
    )

    if (!hasOwnedAudio) {
      if (companionIndex !== -1) {
        items.splice(companionIndex, 1)
        changed = true
      }
      continue
    }

    if (!audioTrackId) continue

    if (companionIndex === -1) {
      items.push({
        id: crypto.randomUUID(),
        type: 'audio',
        trackId: audioTrackId,
        from: nextWrapper.from,
        durationInFrames: nextWrapper.durationInFrames,
        label: nextWrapper.label,
        linkedGroupId,
        compositionId: nextWrapper.compositionId,
        src: '',
        ...sourceFields,
      } satisfies AudioItem)
      changed = true
      continue
    }

    const existingCompanion = items[companionIndex] as AudioItem & { compositionId: string }
    const companionSourceFields = normalizeCompoundWrapperSourceFields({
      item: existingCompanion,
      compositionFps: composition.fps,
      timelineFps,
      fallbackDurationInFrames: composition.durationInFrames,
    })
    const normalizedCompanion: AudioItem & { compositionId: string } = {
      ...existingCompanion,
      trackId: audioTrackId,
      from: nextWrapper.from,
      durationInFrames: nextWrapper.durationInFrames,
      label: nextWrapper.label,
      linkedGroupId,
      compositionId: nextWrapper.compositionId,
      src: existingCompanion.src || '',
      ...companionSourceFields,
    }
    items[companionIndex] = normalizedCompanion
    if (
      normalizedCompanion.trackId !== existingCompanion.trackId ||
      normalizedCompanion.from !== existingCompanion.from ||
      normalizedCompanion.durationInFrames !== existingCompanion.durationInFrames ||
      normalizedCompanion.label !== existingCompanion.label ||
      normalizedCompanion.linkedGroupId !== existingCompanion.linkedGroupId ||
      normalizedCompanion.sourceStart !== existingCompanion.sourceStart ||
      normalizedCompanion.sourceEnd !== existingCompanion.sourceEnd ||
      normalizedCompanion.sourceDuration !== existingCompanion.sourceDuration ||
      normalizedCompanion.sourceFps !== existingCompanion.sourceFps ||
      normalizedCompanion.speed !== existingCompanion.speed ||
      normalizedCompanion.src !== existingCompanion.src
    ) {
      changed = true
    }
  }

  if (!changed) {
    return { project, repaired: false }
  }

  return {
    repaired: true,
    project: {
      ...project,
      timeline: {
        ...project.timeline,
        tracks: tracks as typeof project.timeline.tracks,
        items: items as typeof project.timeline.items,
      },
    },
  }
}

/**
 * Surgically split any audible video that lacks a linked audio companion,
 * across the root timeline and every composition. Preserves track names/order;
 * only appends generated audio (and audio tracks when needed). This catches
 * correctly-laid-out projects that {@link repairLegacyAvTrackLayout} skips —
 * e.g. a video placed via the preview canvas whose audio was never split.
 */
function backfillUnpairedVideoAudio(
  project: Project,
  videoHasAudioByMediaId: Record<string, boolean | undefined>,
): { project: Project; changed: boolean } {
  if (!project.timeline) {
    return { project, changed: false }
  }

  const rootResult = splitUnpairedVideoAudio({
    tracks: (project.timeline.tracks ?? []) as TimelineTrack[],
    items: (project.timeline.items ?? []) as TimelineItem[],
    keyframes: (project.timeline.keyframes ?? []) as ItemKeyframes[],
    videoHasAudioByMediaId,
  })

  let changed = rootResult.changed
  const repairedCompositions = (project.timeline.compositions ?? []).map((composition) => {
    const result = splitUnpairedVideoAudio({
      tracks: composition.tracks as TimelineTrack[],
      items: composition.items as TimelineItem[],
      keyframes: (composition.keyframes ?? []) as ItemKeyframes[],
      videoHasAudioByMediaId,
    })
    if (!result.changed) {
      return composition
    }
    changed = true
    return {
      ...composition,
      tracks: result.tracks as typeof composition.tracks,
      items: result.items as typeof composition.items,
      keyframes: result.keyframes as typeof composition.keyframes,
    }
  })

  if (!changed) {
    return { project, changed: false }
  }

  return {
    changed: true,
    project: {
      ...project,
      timeline: {
        ...project.timeline,
        tracks: rootResult.tracks as typeof project.timeline.tracks,
        items: rootResult.items as typeof project.timeline.items,
        keyframes: rootResult.keyframes as typeof project.timeline.keyframes,
        compositions: repairedCompositions,
      },
    },
  }
}

async function repairLegacyProjectAvLayouts(
  project: Project,
): Promise<{ project: Project; repaired: boolean }> {
  if (!project.timeline) {
    return { project, repaired: false }
  }

  const videoMediaIds = collectVideoMediaIds(project)
  const videoHasAudioByMediaId =
    videoMediaIds.length > 0 ? await buildVideoHasAudioMap(videoMediaIds) : {}
  const rootItems = (project.timeline.items ?? []) as TimelineItem[]
  const rootRepair = needsLegacyAvTrackLayoutRepair({
    tracks: (project.timeline.tracks ?? []) as TimelineTrack[],
    items: rootItems,
  })
    ? repairLegacyAvTrackLayout({
        tracks: (project.timeline.tracks ?? []) as TimelineTrack[],
        items: rootItems,
        keyframes: (project.timeline.keyframes ?? []) as ItemKeyframes[],
        fps: project.metadata.fps,
        videoHasAudioByMediaId,
      })
    : {
        tracks: (project.timeline.tracks ?? []) as TimelineTrack[],
        items: rootItems,
        keyframes: (project.timeline.keyframes ?? []) as ItemKeyframes[],
        changed: false,
      }
  const repairedCompositions = (project.timeline.compositions ?? []).map((composition) => {
    const compositionTracks = composition.tracks as TimelineTrack[]
    const compositionItems = composition.items as TimelineItem[]
    const repair = needsLegacyAvTrackLayoutRepair({
      tracks: compositionTracks,
      items: compositionItems,
    })
      ? repairLegacyAvTrackLayout({
          tracks: compositionTracks,
          items: compositionItems,
          keyframes: (composition.keyframes ?? []) as ItemKeyframes[],
          fps: composition.fps,
          videoHasAudioByMediaId,
        })
      : {
          tracks: compositionTracks,
          items: compositionItems,
          keyframes: (composition.keyframes ?? []) as ItemKeyframes[],
          changed: false,
        }

    return {
      repair,
      composition: repair.changed
        ? {
            ...composition,
            tracks: repair.tracks as typeof composition.tracks,
            items: repair.items as typeof composition.items,
            keyframes: repair.keyframes as typeof composition.keyframes,
          }
        : composition,
    }
  })

  const repairedLayoutProject: Project = {
    ...project,
    timeline: {
      ...project.timeline,
      tracks: rootRepair.tracks as typeof project.timeline.tracks,
      items: rootRepair.items as typeof project.timeline.items,
      keyframes: rootRepair.keyframes as typeof project.timeline.keyframes,
      compositions: repairedCompositions.map((entry) => entry.composition),
    },
  }
  const backfilledAudio = backfillUnpairedVideoAudio(repairedLayoutProject, videoHasAudioByMediaId)
  const repairedCompoundWrappers = repairCompoundClipWrappers(backfilledAudio.project)
  const cleanedEmptyAudioTracks = cleanupRedundantEmptyClassicAudioTracks(
    repairedCompoundWrappers.project,
  )

  const repaired =
    rootRepair.changed ||
    repairedCompositions.some((entry) => entry.repair.changed) ||
    backfilledAudio.changed ||
    repairedCompoundWrappers.repaired ||
    cleanedEmptyAudioTracks.cleaned
  if (!repaired) {
    return { project, repaired: false }
  }

  return {
    repaired: true,
    project: cleanedEmptyAudioTracks.project,
  }
}

interface TimelinePersistenceSnapshot {
  rootTimeline: TimelineSnapshotLike
  compositions: SubComposition[]
  currentFrame: number
  zoomLevel: number
  scrollPosition: number
  busAudioEq?: AudioEqSettings
  masterBusDb: number
  markers: ProjectMarker[]
  inPoint: number | null
  outPoint: number | null
  isRootTimelineLive: boolean
}

/**
 * Capture a Main-rooted project snapshot without navigating the live editor.
 *
 * Main may be live, stashed under a drilled-in composition, or held aside
 * while a sequence/Motion composition is active. The active composition's
 * domain stores can contain edits newer than its registry entry, so fold those
 * live values into the serialized composition without mutating either store.
 */
function captureTimelinePersistenceSnapshot(): TimelinePersistenceSnapshot {
  const currentTimeline = getCurrentTimelineSnapshot()
  const rootTimeline = getRootTimelineSnapshot(currentTimeline)
  const navigation = useCompositionNavigationStore.getState()
  const activeTabId = getActiveTabId(navigation.breadcrumbs)
  const heldRoot =
    activeTabId !== null
      ? navigation.mainHolder
      : navigation.activeCompositionId !== null
        ? navigation.stashStack[0]
        : null
  if ((activeTabId !== null || navigation.activeCompositionId !== null) && !heldRoot) {
    throw new Error('Cannot save while the Main timeline snapshot is unavailable')
  }
  const playback = usePlaybackStore.getState()
  const markers = useMarkersStore.getState()
  const settings = useTimelineSettingsStore.getState()
  const zoom = useZoomStore.getState()
  const rootView =
    activeTabId !== null
      ? useSequencesStore.getState().getSequenceView(ROOT_HISTORY_CONTEXT)
      : undefined
  const activeCompositionId = navigation.activeCompositionId
  const compositions = getEffectiveCompositions(currentTimeline).map((composition) => {
    if (composition.id !== activeCompositionId) return composition

    const contentEnd = currentTimeline.items.reduce(
      (maximum, item) => Math.max(maximum, item.from + item.durationInFrames),
      0,
    )
    const durationInFrames =
      composition.editorKind === 'composite-2d'
        ? Math.max(1, composition.durationInFrames)
        : contentEnd

    return {
      ...composition,
      durationInFrames,
      busAudioEq: playback.busAudioEq,
      markers: markers.markers,
      inPoint: markers.inPoint,
      outPoint: markers.outPoint,
    }
  })

  return {
    rootTimeline,
    compositions,
    currentFrame: heldRoot ? heldRoot.currentFrame : playback.currentFrame,
    zoomLevel: heldRoot?.zoomLevel ?? rootView?.zoomLevel ?? zoom.level,
    scrollPosition: heldRoot?.scrollPosition ?? rootView?.scrollPosition ?? settings.scrollPosition,
    busAudioEq: heldRoot ? heldRoot.busAudioEq : playback.busAudioEq,
    masterBusDb: playback.masterBusDb,
    markers: heldRoot ? heldRoot.markers : markers.markers,
    inPoint: heldRoot ? heldRoot.inPoint : markers.inPoint,
    outPoint: heldRoot ? heldRoot.outPoint : markers.outPoint,
    isRootTimelineLive: activeTabId === null && navigation.activeCompositionId === null,
  }
}

/**
 * Serialize the current timeline domain stores into a {@link ProjectTimeline}.
 *
 * This is the pure store-serialization half of {@link saveTimeline}, factored
 * out so callers that don't persist through workspace storage (e.g. the
 * headless edit harness, which writes project.json itself) can obtain the
 * timeline shape without the thumbnail-generation / storage-write side
 * effects. fps lives in project.metadata, not the timeline.
 */
function buildTimelineFromPersistenceSnapshot(
  snapshot: TimelinePersistenceSnapshot,
): ProjectTimeline {
  const rootTimeline = snapshot.rootTimeline
  const timeline: ProjectTimeline = {
    tracks: rootTimeline.tracks as ProjectTimeline['tracks'],
    items: rootTimeline.items as ProjectTimeline['items'],
    ...(snapshot.busAudioEq && { busAudioEq: snapshot.busAudioEq }),
    masterBusDb: snapshot.masterBusDb,
    currentFrame: snapshot.currentFrame,
    zoomLevel: snapshot.zoomLevel,
    scrollPosition: snapshot.scrollPosition,
    ...(snapshot.inPoint !== null && { inPoint: snapshot.inPoint }),
    ...(snapshot.outPoint !== null && { outPoint: snapshot.outPoint }),
    ...(snapshot.markers.length > 0 && {
      markers: snapshot.markers.map((m) => ({
        id: m.id,
        frame: m.frame,
        color: m.color,
        ...(m.label && { label: m.label }),
      })),
    }),
    ...(rootTimeline.transitions.length > 0 && {
      transitions: rootTimeline.transitions.map(cloneTransitionForProject),
    }),
    ...(rootTimeline.keyframes.length > 0 && {
      keyframes: rootTimeline.keyframes.map((ik) => ({
        itemId: ik.itemId,
        ...(ik.animationVersion && { animationVersion: ik.animationVersion }),
        ...(getDirectPropertyLinks(ik).length > 0 && {
          propertyLinks: getDirectPropertyLinks(ik).map((link) => ({ ...link })),
        }),
        ...(getPropertyExpressions(ik).length > 0 && {
          expressions: getPropertyExpressions(ik).map((expression) => ({ ...expression })),
        }),
        properties: ik.properties.map((pk) => ({
          property: pk.property,
          keyframes: pk.keyframes.map((k) => ({
            id: k.id,
            frame: k.frame,
            value: k.value,
            easing: k.easing,
            ...(k.easingConfig && { easingConfig: k.easingConfig }),
          })),
        })),
        ...(ik.vectorProperties?.length && {
          vectorProperties: ik.vectorProperties.map((property) => ({
            property: property.property,
            keyframes: property.keyframes.map((keyframe) => cloneVectorKeyframe(keyframe)),
          })),
        }),
        ...(ik.separatedVectorProperties?.length && {
          separatedVectorProperties: [...ik.separatedVectorProperties],
        }),
      })),
    }),
    // Sub-compositions (pre-comps)
    ...(() => {
      const comps = snapshot.compositions
      if (comps.length === 0) return {}
      return {
        compositions: comps.map((c) => ({
          id: c.id,
          name: c.name,
          editorKind: c.editorKind ?? 'sequence',
          items: c.items as ProjectTimeline['items'],
          tracks: c.tracks as ProjectTimeline['tracks'],
          ...(c.transitions?.length && {
            transitions: c.transitions.map(
              cloneTransitionForProject,
            ) as ProjectTimeline['transitions'],
          }),
          ...(c.keyframes?.length && { keyframes: c.keyframes as ProjectTimeline['keyframes'] }),
          fps: c.fps,
          width: c.width,
          height: c.height,
          durationInFrames: c.durationInFrames,
          ...(c.backgroundColor && { backgroundColor: c.backgroundColor }),
          compositionControls: c.compositionControls,
          ...(c.busAudioEq && { busAudioEq: c.busAudioEq }),
          ...(c.markers?.length && { markers: c.markers as ProjectTimeline['markers'] }),
          ...(c.inPoint != null && { inPoint: c.inPoint }),
          ...(c.outPoint != null && { outPoint: c.outPoint }),
        })),
      }
    })(),
    // Standalone timeline tabs (multi-timeline) — keep only ids that resolve to
    // an existing composition so tabs never dangle.
    ...(() => {
      const sequenceIds = new Set(
        snapshot.compositions
          .filter((composition) => composition.editorKind !== 'composite-2d')
          .map((composition) => composition.id),
      )
      const topLevelSequenceIds = useSequencesStore
        .getState()
        .topLevelSequenceIds.filter((id) => sequenceIds.has(id))
      return topLevelSequenceIds.length > 0 ? { topLevelSequenceIds } : {}
    })(),
  }

  return sanitizeTimelineEphemeralFields(timeline).timeline
}

export function buildTimelineFromStores(): ProjectTimeline {
  return buildTimelineFromPersistenceSnapshot(captureTimelinePersistenceSnapshot())
}

export async function saveTimeline(projectId: string): Promise<void> {
  const opId = createOperationId()
  const event = logger.startEvent('saveTimeline', opId)
  event.set('projectId', projectId)

  // Saving must not navigate the live editor. A temporary Main swap is still
  // observable by Motion's store subscribers and asynchronous preview renderer.
  const persistenceSnapshot = captureTimelinePersistenceSnapshot()
  const rootTimeline = persistenceSnapshot.rootTimeline

  // Keep the existing thumbnail/event code rooted in Main's captured data.
  const itemsState = {
    items: rootTimeline.items,
    tracks: rootTimeline.tracks,
  }
  const transitionsState = { transitions: rootTimeline.transitions }
  const keyframesState = { keyframes: rootTimeline.keyframes }
  const currentFrame = persistenceSnapshot.currentFrame

  // Serialize the same immutable snapshot used by events and thumbnails.
  const sanitizedTimeline = buildTimelineFromPersistenceSnapshot(persistenceSnapshot)

  event.merge({
    itemCount: itemsState.items.length,
    trackCount: itemsState.tracks.length,
    transitionCount: transitionsState.transitions.length,
    keyframeCount: keyframesState.keyframes.length,
    currentFrame,
  })

  try {
    const project = await getProject(projectId)
    if (!project) {
      throw new Error(`Project not found: ${projectId}`)
    }

    event.merge({
      fps: project.metadata?.fps,
      width: project.metadata?.width,
      height: project.metadata?.height,
    })

    // Generate thumbnail — prefer capturing the existing preview canvas
    // (near-free: reuses the already-initialized scrub renderer with cached
    // media + GPU pipeline) and fall back to a full renderSingleFrame only
    // when the preview capture path is unavailable.
    let thumbnailId: string | undefined
    if (itemsState.items.length > 0) {
      try {
        const width = project.metadata?.width || DEFAULT_PROJECT_WIDTH
        const height = project.metadata?.height || DEFAULT_PROJECT_HEIGHT

        // Calculate thumbnail dimensions preserving project aspect ratio
        const maxThumbWidth = 320
        const maxThumbHeight = 180
        const projectAspectRatio = width / height
        const targetAspectRatio = maxThumbWidth / maxThumbHeight

        let thumbWidth: number
        let thumbHeight: number
        if (projectAspectRatio > targetAspectRatio) {
          thumbWidth = maxThumbWidth
          thumbHeight = Math.round(maxThumbWidth / projectAspectRatio)
        } else {
          thumbHeight = maxThumbHeight
          thumbWidth = Math.round(maxThumbHeight * projectAspectRatio)
        }

        let thumbnailBlob: Blob | null = null

        // Fast path is valid only while Main owns the live preview. In Motion,
        // render Main from its held snapshot instead of saving the Motion canvas
        // as the project cover.
        const captureCanvasSource = usePreviewBridgeStore.getState().captureCanvasSource
        if (captureCanvasSource && persistenceSnapshot.isRootTimelineLive) {
          try {
            const sourceCanvas = await captureCanvasSource()
            if (sourceCanvas) {
              thumbnailBlob = await scaleCanvasToBlob(sourceCanvas, thumbWidth, thumbHeight, 0.85)
            }
          } catch {
            // Fall through to slow path
          }
        }

        // Slow path: full render from scratch (when preview isn't available)
        if (!thumbnailBlob) {
          const fps = project.metadata?.fps || 30
          const backgroundColor = project.metadata?.backgroundColor
          const composition = convertTimelineToComposition(
            itemsState.tracks,
            itemsState.items,
            transitionsState.transitions,
            fps,
            width,
            height,
            null,
            null,
            keyframesState.keyframes,
            backgroundColor,
          )
          const resolvedTracks = await resolveMediaUrls(composition.tracks)
          const resolvedComposition = { ...composition, tracks: resolvedTracks }
          const { renderSingleFrame } = await importCanvasRenderOrchestrator()
          thumbnailBlob = await renderSingleFrame({
            composition: resolvedComposition,
            frame: currentFrame,
            width: thumbWidth,
            height: thumbHeight,
            quality: 0.85,
            format: 'image/jpeg',
          })
        }

        // Save thumbnail to workspace storage
        thumbnailId = `project:${projectId}:cover`
        await saveProjectThumbnail(projectId, thumbnailBlob)
      } catch (thumbError) {
        // Thumbnail generation failure shouldn't block save
        event.set(
          'thumbnailError',
          thumbError instanceof Error ? thumbError.message : String(thumbError),
        )
      }
    }

    // Persist as a PARTIAL update: updateProject re-reads project.json right
    // before writing and merges only these fields, so a concurrent rename /
    // description / metadata / root-folder edit that lands during the async
    // thumbnail work above is preserved. Writing a full record from the
    // pre-await `project` snapshot would clobber those newer fields.
    // Clear the deprecated inline thumbnail field when using thumbnailId.
    const updatedAt = Date.now()
    await updateProject(projectId, {
      timeline: sanitizedTimeline,
      ...(thumbnailId && { thumbnailId, thumbnail: undefined }),
      updatedAt,
    })

    // Mark as clean after successful save
    useTimelineSettingsStore.getState().markClean()

    event.success({ updatedAt, thumbnailId })
  } catch (error) {
    event.failure(error)
    throw error
  }
}

/**
 * Load timeline from project in IndexedDB.
 * Single source of truth for all timeline loading (project open, refresh, etc.)
 *
 * This function:
 * 1. Loads the project from storage
 * 2. Runs migrations if the project schema is outdated
 * 3. Normalizes data to apply current defaults
 * 4. Persists migrated projects back to storage
 * 5. Restores timeline state to stores
 */
/**
 * Populate the timeline domain stores from an already-migrated Project object.
 *
 * This is the pure store-hydration half of {@link loadTimeline}, factored out
 * so callers that already hold a Project (e.g. the headless render/edit
 * harness, which has no workspace storage layer) can hydrate the stores
 * without the storage read, migrated-project persist, or orphaned-media
 * dialog side effects. {@link loadTimeline} calls this after reading +
 * migrating from storage; it then runs media validation on top.
 */
export async function hydrateTimelineStoresFromProject(project: Project): Promise<void> {
  // Unwind the outgoing runtime context before replacing any live domain
  // stores. If a Motion composition is active and root items are loaded first,
  // resetToRoot() mistakes those freshly loaded root items for composition
  // contents and saves them into the active composition on refresh.
  useCompositionNavigationStore.getState().resetToRoot()

  // Swap in this project's saved track heights before any setTracks call, since
  // that is what resolves each track's height. Heights are a local view
  // preference and never come out of the project file.
  loadTrackHeightOverrides(project.id)

  if (project.timeline && project.timeline.tracks?.length > 0) {
    const t = project.timeline

    logger.debug('hydrateTimelineStoresFromProject: loading existing timeline', {
      tracksCount: t.tracks?.length ?? 0,
      itemsCount: t.items?.length ?? 0,
      keyframesCount: t.keyframes?.length ?? 0,
      transitionsCount: t.transitions?.length ?? 0,
      schemaVersion: project.schemaVersion ?? 1,
    })

    // Restore tracks and items from project
    // Sort tracks by order property to preserve user's track arrangement
    const sortedTracks = [...(t.tracks || [])]
      .map((track, index) => ({ track, originalIndex: index }))
      .sort((a, b) => (a.track.order ?? a.originalIndex) - (b.track.order ?? b.originalIndex))
      .map(({ track }) => ({
        ...track,
        items: [], // Items are stored separately
      }))

    // Restore all state to domain stores
    const projectFps = project.metadata?.fps || 30
    const sanitizedInOutPoints = sanitizeInOutPoints({
      inPoint: t.inPoint ?? null,
      outPoint: t.outPoint ?? null,
      maxFrame: getEffectiveTimelineMaxFrame((t.items || []) as TimelineItem[], projectFps),
    })
    const hydratedItems = await reverseConformService.hydrateItems(
      (t.items || []) as TimelineItem[],
    )
    useItemsStore.getState().setTracks(sortedTracks as TimelineTrack[])
    useItemsStore.getState().setItems(hydratedItems)
    useTransitionsStore.getState().setTransitions((t.transitions || []) as Transition[])
    useKeyframesStore.getState().setKeyframes((t.keyframes || []) as ItemKeyframes[])
    useMarkersStore.getState().setMarkers(t.markers || [])
    useMarkersStore.getState().setInPoint(sanitizedInOutPoints.inPoint)
    useMarkersStore.getState().setOutPoint(sanitizedInOutPoints.outPoint)
    useTimelineSettingsStore.getState().setScrollPosition(t.scrollPosition || 0)
    usePlaybackStore.getState().setBusAudioEq(t.busAudioEq)
    usePlaybackStore.getState().setMasterBusDb(t.masterBusDb ?? 0)

    // Restore sub-compositions
    if (t.compositions && t.compositions.length > 0) {
      const hydratedCompositions = await Promise.all(
        t.compositions.map(async (c) => ({
          id: c.id,
          name: c.name,
          editorKind: (c.editorKind === 'composite-2d'
            ? 'composite-2d'
            : 'sequence') as CompositionEditorKind,
          items: await reverseConformService.hydrateItems(c.items as TimelineItem[]),
          tracks: c.tracks as TimelineTrack[],
          transitions: (c.transitions ?? []) as Transition[],
          keyframes: (c.keyframes ?? []) as ItemKeyframes[],
          fps: c.fps,
          width: c.width,
          height: c.height,
          durationInFrames: c.durationInFrames,
          ...(c.backgroundColor && { backgroundColor: c.backgroundColor }),
          compositionControls: c.compositionControls,
          ...(c.busAudioEq && { busAudioEq: c.busAudioEq }),
          markers: c.markers ?? [],
          inPoint: c.inPoint ?? null,
          outPoint: c.outPoint ?? null,
        })),
      )
      useCompositionsStore.getState().setCompositions(hydratedCompositions)
    } else {
      useCompositionsStore.getState().setCompositions([])
    }

    // Restore standalone timeline tabs (multi-timeline). Filter to ids that
    // resolve to a hydrated composition so tabs never dangle.
    const hydratedSequenceIds = new Set(
      useCompositionsStore
        .getState()
        .compositions.filter((composition) => composition.editorKind === 'sequence')
        .map((c) => c.id),
    )
    useSequencesStore.getState().reset()
    useSequencesStore
      .getState()
      .setTopLevelSequenceIds(
        (t.topLevelSequenceIds ?? []).filter((id) => hydratedSequenceIds.has(id)),
      )

    // Restore zoom and playback
    if (t.zoomLevel !== undefined) {
      useZoomStore.getState().setZoomLevel(t.zoomLevel)
    } else {
      useZoomStore.getState().setZoomLevel(1)
    }
    if (t.currentFrame !== undefined) {
      usePlaybackStore.getState().setCurrentFrame(t.currentFrame)
    } else {
      usePlaybackStore.getState().setCurrentFrame(0)
    }
  } else {
    logger.debug('hydrateTimelineStoresFromProject: initializing new project with default track')

    // Initialize with default tracks for new projects
    useItemsStore.getState().setTracks(createDefaultClassicTracks())
    useItemsStore.getState().setItems([])
    useTransitionsStore.getState().setTransitions([])
    useKeyframesStore.getState().setKeyframes([])
    useMarkersStore.getState().setMarkers([])
    useMarkersStore.getState().setInPoint(null)
    useMarkersStore.getState().setOutPoint(null)
    useCompositionsStore.getState().setCompositions([])
    useSequencesStore.getState().reset()
    useTimelineSettingsStore.getState().setScrollPosition(0)
    useZoomStore.getState().setZoomLevel(1)
    usePlaybackStore.getState().setCurrentFrame(0)
    usePlaybackStore.getState().setBusAudioEq(undefined)
  }

  // Common setup for both cases
  // fps is stored in project.metadata, not timeline
  useTimelineSettingsStore.getState().setFps(project.metadata?.fps || 30)
  // snapEnabled is UI state, seeded from the app-level default
  useTimelineSettingsStore.getState().setSnapEnabled(useSettingsStore.getState().snapEnabled)
  useTimelineSettingsStore.getState().markClean()

  // Clear undo history when loading
  useTimelineCommandStore.getState().clearHistory()
}

const inFlightTimelineLoads = new Map<string, Promise<void>>()
let timelineLoadQueueTail: Promise<void> | null = null

function getTimelineLoadKey(projectId: string, options: LoadTimelineOptions): string {
  return JSON.stringify([projectId, options.allowProjectUpgrade === true])
}

export function loadTimeline(projectId: string, options: LoadTimelineOptions = {}): Promise<void> {
  const loadKey = getTimelineLoadKey(projectId, options)
  const inFlightLoad = inFlightTimelineLoads.get(loadKey)
  if (inFlightLoad) return inFlightLoad

  // Keep all project hydration serialized because every load writes into the
  // same live timeline stores. An earlier slow read can no longer finish after
  // and overwrite a later distinct project request.
  useTimelineSettingsStore.getState().setTimelineLoading(true)
  const queueStart = timelineLoadQueueTail
    ? timelineLoadQueueTail.catch(() => undefined)
    : Promise.resolve()

  let pendingLoad: Promise<void>
  pendingLoad = queueStart
    .then(() => loadTimelineOnce(projectId, options))
    .finally(() => {
      if (inFlightTimelineLoads.get(loadKey) === pendingLoad) {
        inFlightTimelineLoads.delete(loadKey)
      }
      if (timelineLoadQueueTail === pendingLoad) {
        timelineLoadQueueTail = null
        useTimelineSettingsStore.getState().setTimelineLoading(false)
      }
    })
  inFlightTimelineLoads.set(loadKey, pendingLoad)
  timelineLoadQueueTail = pendingLoad
  return pendingLoad
}

async function loadTimelineOnce(
  projectId: string,
  options: LoadTimelineOptions = {},
): Promise<void> {
  try {
    const rawProject = await getProject(projectId)
    if (!rawProject) {
      throw new Error(`Project not found: ${projectId}`)
    }

    const storedSchemaVersion = rawProject.schemaVersion ?? 1
    const requiresUpgrade = storedSchemaVersion < CURRENT_SCHEMA_VERSION
    if (requiresUpgrade && !options.allowProjectUpgrade) {
      throw new Error(
        `Project schema v${storedSchemaVersion} requires confirmation before upgrading to v${CURRENT_SCHEMA_VERSION}`,
      )
    }

    // Run migrations and normalization
    const migrationResult = migrateProject(rawProject)
    const repairedLegacyLayouts = await repairLegacyProjectAvLayouts(migrationResult.project)
    const sanitizedTimeline = repairedLegacyLayouts.project.timeline
      ? sanitizeTimelineEphemeralFields(repairedLegacyLayouts.project.timeline)
      : { timeline: repairedLegacyLayouts.project.timeline, cleaned: false }
    const project = sanitizedTimeline.cleaned
      ? {
          ...repairedLegacyLayouts.project,
          timeline: sanitizedTimeline.timeline,
        }
      : repairedLegacyLayouts.project

    // Log migration activity
    if (migrationResult.migrated || repairedLegacyLayouts.repaired || sanitizedTimeline.cleaned) {
      if (migrationResult.appliedMigrations.length > 0) {
        logger.info(
          `Migrated project from v${migrationResult.fromVersion} to v${migrationResult.toVersion}`,
          { migrations: migrationResult.appliedMigrations },
        )
      } else if (sanitizedTimeline.cleaned) {
        logger.info('Removed ephemeral thumbnail URLs from stored timeline items', { projectId })
      } else if (repairedLegacyLayouts.repaired) {
        logger.info('Repaired legacy A/V track layout for project', { projectId })
      } else {
        logger.debug('Project normalized with current defaults')
      }

      // Persist migrated project back to storage
      await updateProject(projectId, {
        ...project,
        schemaVersion: CURRENT_SCHEMA_VERSION,
      })
      logger.debug('Saved migrated project to storage')
    }

    await hydrateTimelineStoresFromProject(project)

    // Validate media references after loading timeline
    const loadedItems = useItemsStore.getState().items
    const orphans = await validateProjectMediaReferences({
      rootItems: loadedItems,
      compositions: useCompositionsStore.getState().compositions,
      projectId,
    })
    if (orphans.length > 0) {
      logger.warn(`Found ${orphans.length} orphaned clip(s) referencing deleted media`)
      useMediaLibraryStore.getState().setOrphanedClips(orphans)
      useMediaLibraryStore.getState().openOrphanedClipsDialog()
    } else {
      useMediaLibraryStore.getState().closeOrphanedClipsDialog()
      useMediaLibraryStore.getState().setOrphanedClips([])
    }
  } catch (error) {
    logger.error('Failed to load timeline:', error)
    throw error
  }
}
