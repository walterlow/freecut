/**
 * Corner Pin Container
 *
 * Bridges between the corner pin store and the overlay.
 * Reads the editing item's transform from the timeline store and
 * passes coordinate params to the overlay.
 */

import { memo, useMemo, useEffect } from 'react';
import { useCornerPinStore } from '../stores/corner-pin-store';
import { useSelectionStore } from '@/shared/state/selection';
import { useItemsStore } from '@/features/preview/deps/timeline-store';
import { CornerPinOverlay } from './corner-pin-overlay';
import type { CoordinateParams, Transform } from '../types/gizmo';
import { resolveTransform, getSourceDimensions } from '@/features/preview/deps/composition-runtime';

interface CornerPinContainerProps {
  containerRect: DOMRect | null;
  playerSize: { width: number; height: number };
  projectSize: { width: number; height: number };
  zoom: number;
}

export const CornerPinContainer = memo(function CornerPinContainer({
  containerRect,
  playerSize,
  projectSize,
  zoom,
}: CornerPinContainerProps) {
  const isEditing = useCornerPinStore((s) => s.isEditing);
  const editingItemId = useCornerPinStore((s) => s.editingItemId);
  const stopEditing = useCornerPinStore((s) => s.stopEditing);

  const selectedItemIds = useSelectionStore((s) => s.selectedItemIds);
  const items = useItemsStore((s) => s.items);

  // Stop editing when the edited item is deselected
  useEffect(() => {
    if (isEditing && editingItemId && !selectedItemIds.includes(editingItemId)) {
      stopEditing();
    }
  }, [isEditing, editingItemId, selectedItemIds, stopEditing]);

  const editingItem = useMemo(
    () => (editingItemId ? items.find((i) => i.id === editingItemId) : null),
    [editingItemId, items],
  );

  const coordParams = useMemo((): CoordinateParams | null => {
    if (!containerRect) return null;
    return { containerRect, playerSize, projectSize, zoom };
  }, [containerRect, playerSize, projectSize, zoom]);

  const itemTransform = useMemo((): Transform | null => {
    if (!editingItem) return null;
    const canvas = { width: projectSize.width, height: projectSize.height, fps: 30 };
    const resolved = resolveTransform(editingItem, canvas, getSourceDimensions(editingItem));
    return {
      x: resolved.x,
      y: resolved.y,
      width: resolved.width,
      height: resolved.height,
      rotation: resolved.rotation,
      opacity: resolved.opacity,
      cornerRadius: resolved.cornerRadius,
    };
  }, [editingItem, projectSize]);

  if (!isEditing || !coordParams || !itemTransform) return null;

  return (
    <CornerPinOverlay
      coordParams={coordParams}
      playerSize={playerSize}
      itemTransform={itemTransform}
    />
  );
});
