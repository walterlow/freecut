import type { CompositionInputProps } from '@/types/export';
import type { TimelineItem } from '@/types/timeline';
import { convertTimelineToComposition } from '../deps/export-contract';
import type { SubComposition } from '../stores/compositions-store';

function sanitizeTimelineItemForSignature(item: TimelineItem) {
  const serializableItem = {
    ...item,
  } as Partial<TimelineItem> & {
    src?: string;
    thumbnailUrl?: string;
    waveformData?: number[];
  };
  delete serializableItem.src;
  delete serializableItem.thumbnailUrl;
  delete serializableItem.waveformData;
  return serializableItem;
}

function buildSignatureNode(
  compositionId: string,
  compositionById: Record<string, SubComposition | undefined>,
  path: ReadonlySet<string>,
): unknown {
  const composition = compositionById[compositionId];
  if (!composition) {
    return { id: compositionId, missing: true };
  }

  if (path.has(compositionId)) {
    return { id: compositionId, cycle: true };
  }

  const nextPath = new Set(path);
  nextPath.add(compositionId);

  return {
    id: composition.id,
    name: composition.name,
    fps: composition.fps,
    width: composition.width,
    height: composition.height,
    durationInFrames: composition.durationInFrames,
    backgroundColor: composition.backgroundColor ?? null,
    tracks: composition.tracks,
    items: composition.items.map((item) => ({
      item: sanitizeTimelineItemForSignature(item),
      child: item.type === 'composition' && item.compositionId
        ? buildSignatureNode(item.compositionId, compositionById, nextPath)
        : null,
    })),
    transitions: composition.transitions,
    keyframes: composition.keyframes,
  };
}

export function buildSubCompositionInput(composition: SubComposition): CompositionInputProps {
  return convertTimelineToComposition(
    composition.tracks,
    composition.items,
    composition.transitions,
    composition.fps,
    composition.width,
    composition.height,
    null,
    null,
    composition.keyframes,
    composition.backgroundColor,
  );
}

export function collectSubCompositionMediaIds(
  compositionId: string,
  compositionById: Record<string, SubComposition | undefined>,
): string[] {
  const mediaIds = new Set<string>();
  const visited = new Set<string>();

  const visit = (currentCompositionId: string) => {
    if (visited.has(currentCompositionId)) {
      return;
    }

    visited.add(currentCompositionId);

    const composition = compositionById[currentCompositionId];
    if (!composition) {
      return;
    }

    for (const item of composition.items) {
      if (item.mediaId) {
        mediaIds.add(item.mediaId);
      }

      if (item.type === 'composition' && item.compositionId) {
        visit(item.compositionId);
      }
    }
  };

  visit(compositionId);
  return [...mediaIds];
}

export function buildSubCompositionPreviewSignature(
  compositionId: string,
  compositionById: Record<string, SubComposition | undefined>,
): string {
  return JSON.stringify(buildSignatureNode(compositionId, compositionById, new Set()));
}

export function getSubCompositionThumbnailFrame(durationInFrames: number): number {
  if (durationInFrames <= 1) {
    return 0;
  }

  return Math.min(
    durationInFrames - 1,
    Math.max(0, Math.round((durationInFrames - 1) * 0.2)),
  );
}
