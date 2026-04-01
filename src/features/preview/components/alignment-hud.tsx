import { useCallback, useMemo } from 'react';
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { Button } from '@/components/ui/button';
import { useSelectionStore } from '@/shared/state/selection';
import { useTimelineStore } from '@/features/preview/deps/timeline-store';
import { useVisualTransforms } from '../hooks/use-visual-transform';
import { EDITOR_LAYOUT_CSS_VALUES } from '@/shared/ui/editor-layout';
import type { TransformProperties } from '@/types/transform';

type AlignmentType =
  | 'left'
  | 'center-h'
  | 'right'
  | 'top'
  | 'center-v'
  | 'bottom'
  | 'distribute-h'
  | 'distribute-v';

const ALIGNMENT_ACTIONS: Array<{
  type: AlignmentType;
  icon: typeof AlignStartHorizontal;
  label: string;
  minItems: number;
}> = [
  { type: 'left', icon: AlignStartVertical, label: 'Align Left', minItems: 1 },
  { type: 'center-h', icon: AlignCenterVertical, label: 'Center Horizontally', minItems: 1 },
  { type: 'right', icon: AlignEndVertical, label: 'Align Right', minItems: 1 },
  { type: 'top', icon: AlignStartHorizontal, label: 'Align Top', minItems: 1 },
  { type: 'center-v', icon: AlignCenterHorizontal, label: 'Center Vertically', minItems: 1 },
  { type: 'bottom', icon: AlignEndHorizontal, label: 'Align Bottom', minItems: 1 },
  { type: 'distribute-h', icon: AlignHorizontalDistributeCenter, label: 'Distribute Horizontally', minItems: 3 },
  { type: 'distribute-v', icon: AlignVerticalDistributeCenter, label: 'Distribute Vertically', minItems: 3 },
];

const BUTTON_STYLE = {
  height: EDITOR_LAYOUT_CSS_VALUES.previewControlButtonSize,
  width: EDITOR_LAYOUT_CSS_VALUES.previewControlButtonSize,
};

interface AlignmentToolbarProps {
  projectSize: { width: number; height: number };
}

export function AlignmentToolbar({ projectSize }: AlignmentToolbarProps) {
  const selectedItemIds = useSelectionStore((s) => s.selectedItemIds);
  const updateItemsTransformMap = useTimelineStore((s) => s.updateItemsTransformMap);

  const visualItems = useTimelineStore(
    useShallow((s) =>
      s.items.filter((item) => item.type !== 'audio' && item.type !== 'adjustment')
    )
  );

  const selectedItemIdsSet = useMemo(() => new Set(selectedItemIds), [selectedItemIds]);

  const selectedVisualItems = useMemo(() => {
    return visualItems.filter((item) => selectedItemIdsSet.has(item.id));
  }, [visualItems, selectedItemIdsSet]);

  const visualTransformsMap = useVisualTransforms(selectedVisualItems, projectSize);

  const itemCount = selectedVisualItems.length;

  const handleAlign = useCallback((alignment: AlignmentType) => {
    const tolerance = 0.5;
    const updates = new Map<string, Partial<TransformProperties>>();

    const entries = selectedVisualItems
      .map((item) => {
        const resolved = visualTransformsMap.get(item.id);
        if (!resolved) return null;
        return { id: item.id, x: resolved.x, y: resolved.y, width: resolved.width, height: resolved.height };
      })
      .filter(<T,>(v: T | null): v is T => v !== null);

    if (entries.length === 0) return;

    if (alignment === 'distribute-h' || alignment === 'distribute-v') {
      if (entries.length < 3) return;
      const axis = alignment === 'distribute-h' ? 'x' : 'y';
      const sorted = [...entries].sort((a, b) => a[axis] - b[axis]);
      const first = sorted[0]!;
      const last = sorted[sorted.length - 1]!;
      const step = (last[axis] - first[axis]) / (sorted.length - 1);

      for (let index = 1; index < sorted.length - 1; index += 1) {
        const entry = sorted[index]!;
        const target = first[axis] + step * index;
        if (Math.abs(target - entry[axis]) <= tolerance) continue;
        updates.set(entry.id, axis === 'x' ? { x: target } : { y: target });
      }
    } else {
      for (const entry of entries) {
        let nextX: number | undefined;
        let nextY: number | undefined;

        switch (alignment) {
          case 'left':
            nextX = -projectSize.width / 2 + entry.width / 2;
            break;
          case 'center-h':
            nextX = 0;
            break;
          case 'right':
            nextX = projectSize.width / 2 - entry.width / 2;
            break;
          case 'top':
            nextY = -projectSize.height / 2 + entry.height / 2;
            break;
          case 'center-v':
            nextY = 0;
            break;
          case 'bottom':
            nextY = projectSize.height / 2 - entry.height / 2;
            break;
        }

        const props: Partial<TransformProperties> = {};
        if (nextX !== undefined && Math.abs(nextX - entry.x) > tolerance) props.x = nextX;
        if (nextY !== undefined && Math.abs(nextY - entry.y) > tolerance) props.y = nextY;
        if (Object.keys(props).length > 0) updates.set(entry.id, props);
      }
    }

    if (updates.size > 0) {
      updateItemsTransformMap(updates, { operation: 'move' });
    }
  }, [selectedVisualItems, visualTransformsMap, projectSize, updateItemsTransformMap]);

  if (itemCount < 1) return null;

  return (
    <>
      {ALIGNMENT_ACTIONS.map(({ type, icon: Icon, label, minItems }) => (
        <Button
          key={type}
          variant="ghost"
          size="icon"
          className="flex-shrink-0 text-muted-foreground hover:text-foreground"
          style={BUTTON_STYLE}
          onClick={() => handleAlign(type)}
          disabled={itemCount < minItems}
          data-tooltip={label}
          aria-label={label}
        >
          <Icon className="w-4 h-4" />
        </Button>
      ))}
    </>
  );
}
