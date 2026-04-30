import { getMediaDragData } from '@/features/timeline/deps/media-library-resolver'
import type { TrackKind } from './classic-tracks'
import { getTemplateEffectsForDirectApplication } from './generated-layer-items'

export const TIMELINE_DROP_TARGET_SELECTOR = '[data-timeline-drop-target="true"]'

type TimelineDragData = ReturnType<typeof getMediaDragData>

export function isDirectEffectTemplateDragData(data: TimelineDragData): boolean {
  return !!getTemplateEffectsForDirectApplication(data)
}

export function shouldIgnoreTrackDropPreviewForDrag(
  data: TimelineDragData,
  trackKind: TrackKind | null,
): boolean {
  return isDirectEffectTemplateDragData(data) && trackKind === 'audio'
}

export function shouldIgnoreNewTrackZonePreviewForDrag(
  data: TimelineDragData,
  zone: 'video' | 'audio',
): boolean {
  return isDirectEffectTemplateDragData(data) && zone !== 'video'
}

export function isExternalTimelineDragEvent(event: DragEvent): boolean {
  return !!getMediaDragData() || !!event.dataTransfer?.types.includes('Files')
}

export function isDragEventOverSelector(event: DragEvent, selector: string): boolean {
  if (event.clientX === 0 && event.clientY === 0) {
    return event.target instanceof Element && !!event.target.closest(selector)
  }

  return document
    .elementsFromPoint(event.clientX, event.clientY)
    .some((element) => !!element.closest(selector))
}

export function isDragEventOverTimelineDropTarget(event: DragEvent): boolean {
  return isDragEventOverSelector(event, TIMELINE_DROP_TARGET_SELECTOR)
}
