import type { ProjectTimeline } from '@/types/project'
import type { BundleProject } from '../types/bundle'

type BundleTimeline = NonNullable<BundleProject['timeline']>

function convertItemsForBundle(items: ProjectTimeline['items']): BundleTimeline['items'] {
  return items.map((item) => {
    const { mediaId, ...rest } = item
    const itemWithoutPreviewUrls = { ...rest }
    delete itemWithoutPreviewUrls.src
    delete itemWithoutPreviewUrls.thumbnailUrl
    return {
      ...itemWithoutPreviewUrls,
      ...(mediaId && { mediaRef: mediaId }),
    }
  }) as BundleTimeline['items']
}

function restoreItemsFromBundle(
  items: BundleTimeline['items'],
  mediaIdMap: Map<string, string>,
): ProjectTimeline['items'] {
  return items.map((item) => {
    const { mediaRef, ...rest } = item
    return {
      ...rest,
      ...(mediaRef && { mediaId: mediaIdMap.get(mediaRef) }),
      src: undefined,
      thumbnailUrl: undefined,
    }
  }) as ProjectTimeline['items']
}

export function convertTimelineForBundle(timeline: ProjectTimeline): BundleTimeline {
  return {
    ...timeline,
    items: convertItemsForBundle(timeline.items),
    compositions: timeline.compositions?.map((composition) => ({
      ...composition,
      items: convertItemsForBundle(composition.items as ProjectTimeline['items']),
    })),
  }
}

export function restoreTimelineFromBundle(
  timeline: BundleProject['timeline'] | undefined,
  mediaIdMap: Map<string, string>,
): ProjectTimeline | undefined {
  if (!timeline) {
    return undefined
  }

  return {
    ...timeline,
    items: restoreItemsFromBundle(timeline.items, mediaIdMap),
    compositions: timeline.compositions?.map((composition) => ({
      ...composition,
      items: restoreItemsFromBundle(composition.items, mediaIdMap),
    })),
  }
}
