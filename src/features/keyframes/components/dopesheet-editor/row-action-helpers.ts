import type { AnimatableProperty, Keyframe, KeyframeRef } from '@/types/keyframe';

interface DopesheetPropertyRowLike {
  property: AnimatableProperty;
  keyframes: Keyframe[];
}

interface CurrentGroupKeyframeLike {
  property: AnimatableProperty;
  keyframe: Keyframe;
}

export function buildRowKeyframeRefs<TRow extends DopesheetPropertyRowLike>(
  itemId: string,
  rows: TRow[]
): KeyframeRef[] {
  return rows.flatMap((row) =>
    row.keyframes.map((keyframe) => ({
      itemId,
      property: row.property,
      keyframeId: keyframe.id,
    }))
  );
}

export function buildPropertyKeyframeRefs(
  itemId: string,
  property: AnimatableProperty,
  keyframes: Keyframe[]
): KeyframeRef[] {
  return keyframes.map((keyframe) => ({
    itemId,
    property,
    keyframeId: keyframe.id,
  }));
}

export function removeSelectionIds(
  selectedKeyframeIds: Set<string>,
  removedKeyframeIds: Iterable<string>
): Set<string> {
  const nextSelection = new Set(selectedKeyframeIds);
  for (const keyframeId of removedKeyframeIds) {
    nextSelection.delete(keyframeId);
  }
  return nextSelection;
}

export function buildGroupAddEntries<TRow extends DopesheetPropertyRowLike>(
  rows: TRow[],
  currentFrame: number,
  canAddKeyframeForRow: (row: TRow) => boolean
): Array<{ property: AnimatableProperty; frame: number }> {
  return rows.flatMap((row) =>
    canAddKeyframeForRow(row) ? [{ property: row.property, frame: currentFrame }] : []
  );
}

export function getRemovableGroupCurrentKeyframes(
  currentKeyframes: CurrentGroupKeyframeLike[],
  isPropertyLocked: (property: AnimatableProperty) => boolean
): CurrentGroupKeyframeLike[] {
  return currentKeyframes.filter(({ property }) => !isPropertyLocked(property));
}
