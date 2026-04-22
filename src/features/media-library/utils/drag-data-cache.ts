import type { VisualEffect } from '@/types/effects';
import type { TextStylePresetId } from '@/shared/typography/text-style-presets';

/**
 * Cache for media drag data
 *
 * This module provides a way to share drag data between the media library
 * and timeline components. This is necessary because dataTransfer.getData()
 * is not accessible during dragover events for security reasons.
 */

interface DragMediaItem {
  mediaId: string;
  mediaType: string;
  fileName: string;
  duration: number;
}

interface MediaDragData {
  type: 'media-item' | 'media-items';
  items?: DragMediaItem[];
  mediaId?: string;
  mediaType?: string;
  fileName?: string;
  duration?: number;
}

export interface CompositionDragData {
  type: 'composition';
  compositionId: string;
  name: string;
  durationInFrames: number;
  width: number;
  height: number;
}

export interface TimelineTemplateDragData {
  type: 'timeline-template';
  itemType: 'text' | 'shape' | 'adjustment';
  label: string;
  textStylePresetId?: TextStylePresetId;
  shapeType?: 'rectangle' | 'circle' | 'triangle' | 'ellipse' | 'star' | 'polygon' | 'heart' | 'path';
  effects?: VisualEffect[];
}

export type DragData = MediaDragData | CompositionDragData | TimelineTemplateDragData;

const TIMELINE_EXTERNAL_MEDIA_DRAG_CLASS = 'timeline-external-media-drag';

let cachedDragData: DragData | null = null;

function shouldEnableTimelinePointerPassthrough(data: DragData | null): boolean {
  return data?.type === 'media-item' || data?.type === 'media-items' || data?.type === 'composition';
}

function syncTimelinePointerPassthrough(data: DragData | null): void {
  if (typeof document === 'undefined') {
    return;
  }

  document.body.classList.toggle(
    TIMELINE_EXTERNAL_MEDIA_DRAG_CLASS,
    shouldEnableTimelinePointerPassthrough(data)
  );
}

export function setMediaDragData(data: DragData): void {
  cachedDragData = data;
  syncTimelinePointerPassthrough(data);
}

export function getMediaDragData(): DragData | null {
  return cachedDragData;
}

export function clearMediaDragData(): void {
  cachedDragData = null;
  syncTimelinePointerPassthrough(null);
}
