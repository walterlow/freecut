import type { AudioItem, CompositionItem } from '@/types/timeline';
import type { SubComposition } from '../stores/compositions-store';
import { getCompositionOwnedAudioSources } from './composition-clip-summary';
import type { DroppableMediaType } from './dropped-media';

export interface DroppedCompositionPlacement {
  trackId: string;
  from: number;
  durationInFrames: number;
  mediaType: DroppableMediaType;
}

export function compositionHasOwnedAudio(params: {
  composition: SubComposition;
  compositionById?: Record<string, SubComposition | undefined>;
}): boolean {
  return getCompositionOwnedAudioSources({
    items: params.composition.items,
    tracks: params.composition.tracks,
    fps: params.composition.fps,
    compositionById: params.compositionById,
  }).length > 0;
}

export function buildDroppedCompositionTimelineItems(params: {
  compositionId: string;
  composition: SubComposition;
  label: string;
  placements: DroppedCompositionPlacement[];
}): Array<CompositionItem | AudioItem> {
  const visualPlacement = params.placements.find((placement) => placement.mediaType !== 'audio');
  const audioPlacement = params.placements.find((placement) => placement.mediaType === 'audio');
  const wrapperSourceFields = {
    sourceStart: 0,
    sourceEnd: params.composition.durationInFrames,
    sourceDuration: params.composition.durationInFrames,
    sourceFps: params.composition.fps,
    speed: 1,
  };
  const linkedGroupId = visualPlacement && audioPlacement ? crypto.randomUUID() : undefined;
  const items: Array<CompositionItem | AudioItem> = [];

  if (visualPlacement) {
    items.push({
      id: crypto.randomUUID(),
      type: 'composition',
      trackId: visualPlacement.trackId,
      from: visualPlacement.from,
      durationInFrames: visualPlacement.durationInFrames,
      label: params.label,
      compositionId: params.compositionId,
      linkedGroupId,
      compositionWidth: params.composition.width,
      compositionHeight: params.composition.height,
      transform: {
        x: 0,
        y: 0,
        rotation: 0,
        opacity: 1,
      },
      ...wrapperSourceFields,
    });
  }

  if (audioPlacement) {
    items.push({
      id: crypto.randomUUID(),
      type: 'audio',
      trackId: audioPlacement.trackId,
      from: audioPlacement.from,
      durationInFrames: audioPlacement.durationInFrames,
      label: params.label,
      compositionId: params.compositionId,
      linkedGroupId,
      src: '',
      ...wrapperSourceFields,
    });
  }

  return items;
}
