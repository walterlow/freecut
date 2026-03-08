type StableVideoGroupItem = {
  id: string;
  mediaId?: string;
  originId?: string;
  from: number;
  durationInFrames: number;
  speed?: number;
};

export interface StableVideoGroup<TItem extends StableVideoGroupItem = StableVideoGroupItem> {
  originKey: string;
  items: TItem[];
  minFrom: number;
  maxEnd: number;
}

export function findActiveVideoItemIndex<TItem extends StableVideoGroupItem>(
  items: TItem[],
  frame: number,
): number {
  let low = 0;
  let high = items.length - 1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    const item = items[mid]!;
    const start = item.from;
    const end = item.from + item.durationInFrames;

    if (frame < start) {
      high = mid - 1;
      continue;
    }

    if (frame >= end) {
      low = mid + 1;
      continue;
    }

    let rightmost = mid;
    while (rightmost + 1 < items.length) {
      const next = items[rightmost + 1]!;
      const nextStart = next.from;
      const nextEnd = next.from + next.durationInFrames;
      if (frame >= nextStart && frame < nextEnd) {
        rightmost += 1;
        continue;
      }
      break;
    }

    return rightmost;
  }

  return -1;
}

export function groupStableVideoItems<TItem extends StableVideoGroupItem>(
  items: TItem[],
): StableVideoGroup<TItem>[] {
  const itemsByOriginKey = new Map<string, TItem[]>();

  for (const item of items) {
    const originId = item.originId || item.id;
    const key = `${item.mediaId}-${originId}`;
    const originItems = itemsByOriginKey.get(key);
    if (originItems) {
      originItems.push(item);
      continue;
    }
    itemsByOriginKey.set(key, [item]);
  }

  const groups: StableVideoGroup<TItem>[] = [];

  for (const [originKey, originItems] of itemsByOriginKey) {
    const sortedItems = originItems.toSorted((a, b) => a.from - b.from);
    let currentGroup: TItem[] = [sortedItems[0]!];
    let currentEnd = sortedItems[0]!.from + sortedItems[0]!.durationInFrames;

    for (let i = 1; i < sortedItems.length; i++) {
      const item = sortedItems[i]!;
      const itemHasCustomSpeed = (item.speed ?? 1) !== 1;
      const groupHasCustomSpeed = currentGroup.some((groupItem) => (groupItem.speed ?? 1) !== 1);
      const speedMismatch = itemHasCustomSpeed || groupHasCustomSpeed;

      if (item.from <= currentEnd + 1 && !speedMismatch) {
        currentGroup.push(item);
        currentEnd = Math.max(currentEnd, item.from + item.durationInFrames);
        continue;
      }

      const firstItemId = currentGroup[0]!.id;
      groups.push({
        originKey: `${originKey}-${firstItemId}`,
        items: currentGroup,
        minFrom: Math.min(...currentGroup.map((groupItem) => groupItem.from)),
        maxEnd: Math.max(...currentGroup.map((groupItem) => groupItem.from + groupItem.durationInFrames)),
      });
      currentGroup = [item];
      currentEnd = item.from + item.durationInFrames;
    }

    const firstItemId = currentGroup[0]!.id;
    groups.push({
      originKey: `${originKey}-${firstItemId}`,
      items: currentGroup,
      minFrom: Math.min(...currentGroup.map((groupItem) => groupItem.from)),
      maxEnd: Math.max(...currentGroup.map((groupItem) => groupItem.from + groupItem.durationInFrames)),
    });
  }

  return groups;
}

export function collectShadowItemIndices<TItem extends StableVideoGroupItem>({
  items,
  activeItemIndex,
  globalFrame,
  lookaheadFrames,
}: {
  items: TItem[];
  activeItemIndex: number;
  globalFrame: number;
  lookaheadFrames: number;
}): number[] {
  if (activeItemIndex < 0 || items.length <= 1) {
    return [];
  }

  const indices: number[] = [];
  for (let i = 0; i < items.length; i++) {
    if (i === activeItemIndex) continue;
    const item = items[i]!;
    const itemEnd = item.from + item.durationInFrames;
    if (globalFrame + lookaheadFrames >= item.from && globalFrame < itemEnd) {
      indices.push(i);
    }
  }

  return indices;
}
