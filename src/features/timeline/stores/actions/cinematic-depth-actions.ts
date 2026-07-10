import type { ImageItem, TimelineTrack } from '@/types/timeline'
import type {
  CinematicDepthLayerAsset,
  CinematicDepthLayerPlacement,
  InsertCinematicDepthLayersResult,
} from '../../types'
import { useSelectionStore } from '@/shared/state/selection'
import { DEFAULT_TRACK_HEIGHT } from '../../constants'
import { useItemsStore } from '../items-store'
import { useTimelineSettingsStore } from '../timeline-settings-store'
import { execute, warnIfOverlapping } from './shared'

function clamp01(value: number | undefined): number | undefined {
  if (value == null || !Number.isFinite(value)) return undefined
  return Math.min(1, Math.max(0, value))
}

function isStillImage(item: unknown): item is ImageItem {
  return (
    !!item &&
    typeof item === 'object' &&
    (item as ImageItem).type === 'image' &&
    !/\.gif$/i.test((item as ImageItem).label ?? '')
  )
}

function createCinematicDepthTrack(params: {
  name: string
  order: number
  visible?: boolean
}): TimelineTrack {
  return {
    id: `track-${crypto.randomUUID()}`,
    name: params.name,
    kind: 'video',
    height: DEFAULT_TRACK_HEIGHT,
    locked: false,
    syncLock: true,
    visible: params.visible ?? true,
    muted: false,
    solo: false,
    volume: 0,
    order: params.order,
    items: [],
  }
}

function getTopVideoOrder(tracks: TimelineTrack[]): number {
  const videoOrders = tracks
    .filter((track) => track.kind === 'video' || /^V\d+$/i.test(track.name))
    .map((track) => track.order)
    .filter((order) => Number.isFinite(order))

  if (videoOrders.length === 0) return 0
  return Math.min(...videoOrders)
}

function createDepthLayerItem(params: {
  source: ImageItem
  asset: CinematicDepthLayerAsset
  role: 'subject' | 'depth-map'
  trackId: string
  depthSourceId: string
  depthQuality?: number
}): ImageItem {
  const isDepthMap = params.role === 'depth-map'
  return {
    ...params.source,
    id: crypto.randomUUID(),
    trackId: params.trackId,
    label: params.asset.label,
    mediaId: params.asset.mediaId,
    src: params.asset.src,
    thumbnailUrl: params.asset.thumbnailUrl ?? undefined,
    sourceWidth: params.asset.sourceWidth ?? params.source.sourceWidth,
    sourceHeight: params.asset.sourceHeight ?? params.source.sourceHeight,
    originId: params.source.originId ?? params.source.id,
    cinematicDepthRole: params.role,
    cinematicDepthSourceId: params.depthSourceId,
    cinematicDepthQuality: clamp01(params.depthQuality),
    transform: {
      ...params.source.transform,
      opacity: isDepthMap ? 0 : (params.source.transform?.opacity ?? 1),
    },
  }
}

function emptyResult(
  status: InsertCinematicDepthLayersResult['status'],
): InsertCinematicDepthLayersResult {
  return {
    status,
    sourceImageCount: 0,
    layerCount: 0,
    trackCount: 0,
    itemIds: [],
    sourceItemIds: [],
    visibleItemIds: [],
  }
}

function planDepthTracks(
  placements: CinematicDepthLayerPlacement[],
  tracks: TimelineTrack[],
): {
  newTracks: TimelineTrack[]
  subjectTrackId: string | null
  depthTrackId: string | null
} {
  const needsSubjectTrack = placements.some((placement) => placement.subjectAsset)
  const needsDepthTrack = placements.some((placement) => placement.depthMapAsset)
  const topOrder = getTopVideoOrder(tracks)
  const newTracks: TimelineTrack[] = []
  let nextOrder = topOrder - (needsSubjectTrack && needsDepthTrack ? 2 : 1)
  let depthTrackId: string | null = null
  let subjectTrackId: string | null = null

  if (needsDepthTrack) {
    const depthTrack = createCinematicDepthTrack({
      name: 'Cinematic Depth Maps',
      order: nextOrder,
      visible: false,
    })
    depthTrackId = depthTrack.id
    newTracks.push(depthTrack)
    nextOrder += 1
  }

  if (needsSubjectTrack) {
    const subjectTrack = createCinematicDepthTrack({
      name: 'Cinematic Subjects',
      order: nextOrder,
    })
    subjectTrackId = subjectTrack.id
    newTracks.push(subjectTrack)
  }

  return { newTracks, subjectTrackId, depthTrackId }
}

function countBackgroundAssets(placements: CinematicDepthLayerPlacement[]): number {
  return placements.filter((placement) => placement.backgroundAsset).length
}

function createLayerItemIfReady(params: {
  source: ImageItem
  placement: CinematicDepthLayerPlacement
  role: 'subject' | 'depth-map'
  trackId: string | null
  depthSourceId: string
  depthQuality?: number
}): ImageItem | null {
  const asset =
    params.role === 'subject' ? params.placement.subjectAsset : params.placement.depthMapAsset
  if (!asset || !params.trackId) return null

  return createDepthLayerItem({
    source: params.source,
    asset,
    role: params.role,
    trackId: params.trackId,
    depthSourceId: params.depthSourceId,
    depthQuality: params.depthQuality,
  })
}

function buildDepthLayerItems(params: {
  placements: CinematicDepthLayerPlacement[]
  sourceById: Map<string, ImageItem>
  subjectTrackId: string | null
  depthTrackId: string | null
}): {
  sourceItemIds: string[]
  visibleItemIds: string[]
  newItems: ImageItem[]
} {
  const sourceItemIds: string[] = []
  const visibleItemIds: string[] = []
  const newItems: ImageItem[] = []

  for (const placement of params.placements) {
    const source = params.sourceById.get(placement.sourceItemId)
    if (!source) continue

    const depthSourceId =
      placement.depthSourceId ?? source.cinematicDepthSourceId ?? source.mediaId ?? source.id
    const depthQuality = clamp01(placement.depthQuality)
    sourceItemIds.push(source.id)
    visibleItemIds.push(source.id)

    const subject = createLayerItemIfReady({
      source,
      placement,
      role: 'subject',
      trackId: params.subjectTrackId,
      depthSourceId,
      depthQuality,
    })
    const depthMap = createLayerItemIfReady({
      source,
      placement,
      role: 'depth-map',
      trackId: params.depthTrackId,
      depthSourceId,
      depthQuality,
    })

    if (subject) {
      newItems.push(subject)
      visibleItemIds.push(subject.id)
    }
    if (depthMap) newItems.push(depthMap)
  }

  return { sourceItemIds, visibleItemIds, newItems }
}

function buildSourceDepthUpdate(
  source: ImageItem,
  placement: CinematicDepthLayerPlacement,
): Partial<ImageItem> {
  const backgroundAsset = placement.backgroundAsset
  const depthSourceId =
    placement.depthSourceId ?? source.cinematicDepthSourceId ?? source.mediaId ?? source.id
  const baseUpdate: Partial<ImageItem> = {
    cinematicDepthRole: 'background',
    cinematicDepthSourceId: depthSourceId,
    cinematicDepthQuality: clamp01(placement.depthQuality),
  }

  if (!backgroundAsset) return baseUpdate

  return {
    ...baseUpdate,
    label: backgroundAsset.label,
    mediaId: backgroundAsset.mediaId,
    src: backgroundAsset.src,
    thumbnailUrl: backgroundAsset.thumbnailUrl ?? undefined,
    sourceWidth: backgroundAsset.sourceWidth ?? source.sourceWidth,
    sourceHeight: backgroundAsset.sourceHeight ?? source.sourceHeight,
  }
}

function updateSourceDepthRoles(params: {
  sourceItemIds: string[]
  placements: CinematicDepthLayerPlacement[]
  sourceById: Map<string, ImageItem>
}): void {
  const store = useItemsStore.getState()
  const placementBySourceId = new Map(
    params.placements.map((placement) => [placement.sourceItemId, placement]),
  )

  for (const sourceId of params.sourceItemIds) {
    const placement = placementBySourceId.get(sourceId)
    const source = params.sourceById.get(sourceId)
    if (!source || !placement) continue

    store._updateItem(sourceId, buildSourceDepthUpdate(source, placement))
  }
}

export function insertCinematicDepthLayers(
  placements: CinematicDepthLayerPlacement[],
): InsertCinematicDepthLayersResult {
  const preparedPlacements = placements.filter(
    (placement) => placement.backgroundAsset || placement.subjectAsset || placement.depthMapAsset,
  )

  if (preparedPlacements.length === 0) {
    return emptyResult('empty')
  }

  const itemStore = useItemsStore.getState()
  const sourceById = new Map(itemStore.items.filter(isStillImage).map((item) => [item.id, item]))
  const sourceItems = preparedPlacements
    .map((placement) => sourceById.get(placement.sourceItemId))
    .filter((item): item is ImageItem => !!item)

  if (sourceItems.length === 0) {
    return emptyResult('no-images')
  }

  const trackPlan = planDepthTracks(preparedPlacements, itemStore.tracks)
  const itemPlan = buildDepthLayerItems({
    placements: preparedPlacements,
    sourceById,
    subjectTrackId: trackPlan.subjectTrackId,
    depthTrackId: trackPlan.depthTrackId,
  })
  const { sourceItemIds, visibleItemIds, newItems } = itemPlan

  if (newItems.length === 0 && sourceItemIds.length === 0) {
    return emptyResult('empty')
  }

  execute(
    'INSERT_CINEMATIC_DEPTH_LAYERS',
    () => {
      const store = useItemsStore.getState()
      if (trackPlan.newTracks.length > 0) {
        store.setTracks([...store.tracks, ...trackPlan.newTracks])
      }
      updateSourceDepthRoles({ sourceItemIds, placements: preparedPlacements, sourceById })
      store._addItems(newItems)
      useTimelineSettingsStore.getState().markDirty()
      useSelectionStore.getState().selectItems(visibleItemIds)
      warnIfOverlapping('insertCinematicDepthLayers')
    },
    {
      sourceImageCount: sourceItemIds.length,
      layerCount: newItems.length + countBackgroundAssets(preparedPlacements),
    },
  )

  return {
    status: 'inserted',
    sourceImageCount: sourceItemIds.length,
    layerCount: newItems.length + countBackgroundAssets(preparedPlacements),
    trackCount: trackPlan.newTracks.length,
    itemIds: newItems.map((item) => item.id),
    sourceItemIds,
    visibleItemIds,
  }
}
