import { getVideoTargetTimeSeconds } from '@/features/preview/deps/composition-runtime';
import type { TimelineItem, VideoItem } from '@/types/timeline';

export interface SelectedVideoWarmCandidate {
  item: VideoItem;
  sourceTimeSeconds: number;
  withinClip: boolean;
}

export function resolveSelectedVideoWarmCandidate(
  selectedItemIds: readonly string[],
  itemsById: ReadonlyMap<string, TimelineItem>,
  currentFrame: number,
  fps: number,
): SelectedVideoWarmCandidate | null {
  const selectedItemId = selectedItemIds[0];
  if (!selectedItemId) return null;

  const selectedItem = itemsById.get(selectedItemId);
  if (!selectedItem || selectedItem.type !== 'video' || !selectedItem.src) {
    return null;
  }

  const localFrame = currentFrame - selectedItem.from;
  const sourceStart = selectedItem.sourceStart ?? selectedItem.trimStart ?? 0;
  const sourceFps = selectedItem.sourceFps ?? fps;
  const playbackRate = selectedItem.speed ?? 1;

  return {
    item: selectedItem,
    sourceTimeSeconds: getVideoTargetTimeSeconds(
      sourceStart,
      sourceFps,
      localFrame,
      playbackRate,
      fps,
    ),
    withinClip: currentFrame >= selectedItem.from
      && currentFrame < (selectedItem.from + selectedItem.durationInFrames),
  };
}
