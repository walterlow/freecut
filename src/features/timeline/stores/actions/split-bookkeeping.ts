import type { TimelineItem } from '@/types/timeline';
import { useItemsStore } from '../items-store';
import { useTransitionsStore } from '../transitions-store';

export interface SplitResultEntry {
  originalId: string;
  originalLinkedGroupId: string | undefined;
  result: {
    leftItem: TimelineItem;
    rightItem: TimelineItem;
  };
}

function remapTransitionsAfterSplit(splitResults: SplitResultEntry[]): void {
  if (splitResults.length === 0) {
    return;
  }

  const splitRightByOriginalId = new Map(
    splitResults.map((entry) => [entry.originalId, entry.result.rightItem.id]),
  );

  const updatedTransitions = useTransitionsStore.getState().transitions.map((transition) => {
    const leftReplacementId = splitRightByOriginalId.get(transition.leftClipId);
    if (leftReplacementId) {
      return { ...transition, leftClipId: leftReplacementId };
    }
    if (splitRightByOriginalId.has(transition.rightClipId)) {
      return transition;
    }
    return transition;
  });

  useTransitionsStore.getState().setTransitions(updatedTransitions);
}

function relinkSplitSegments(splitResults: SplitResultEntry[]): void {
  const linkedSplitResults = splitResults.filter((entry) => !!entry.originalLinkedGroupId);
  if (linkedSplitResults.length === 0) {
    return;
  }

  const itemsStore = useItemsStore.getState();
  const leftLinkedGroupId = linkedSplitResults.length > 1 ? crypto.randomUUID() : undefined;
  const rightLinkedGroupId = linkedSplitResults.length > 1 ? crypto.randomUUID() : undefined;

  for (const entry of linkedSplitResults) {
    itemsStore._updateItem(entry.result.leftItem.id, { linkedGroupId: leftLinkedGroupId });
    itemsStore._updateItem(entry.result.rightItem.id, { linkedGroupId: rightLinkedGroupId });
  }
}

export function applySplitBookkeeping(splitResults: SplitResultEntry[]): void {
  if (splitResults.length === 0) {
    return;
  }

  remapTransitionsAfterSplit(splitResults);
  relinkSplitSegments(splitResults);
}
