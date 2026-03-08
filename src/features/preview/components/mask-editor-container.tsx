/**
 * Mask Editor Container
 *
 * Bridges between the mask editor store and the mask editor overlay.
 * Reads the editing item's transform from the timeline store and
 * passes coordinate params to the overlay.
 */

import { memo, useMemo } from 'react';
import { useMaskEditorStore } from '../stores/mask-editor-store';
import { useItemsStore } from '@/features/preview/deps/timeline-store';
import { MaskEditorOverlay } from './mask-editor-overlay';
import type { CoordinateParams, Transform } from '../types/gizmo';
import { useVisualTransforms } from '../hooks/use-visual-transform';

interface MaskEditorContainerProps {
  containerRect: DOMRect | null;
  playerSize: { width: number; height: number };
  projectSize: { width: number; height: number };
  zoom: number;
}

export const MaskEditorContainer = memo(function MaskEditorContainer({
  containerRect,
  playerSize,
  projectSize,
  zoom,
}: MaskEditorContainerProps) {
  const isEditing = useMaskEditorStore((s) => s.isEditing);
  const editingItemId = useMaskEditorStore((s) => s.editingItemId);
  const shapePenMode = useMaskEditorStore((s) => s.shapePenMode);

  const items = useItemsStore((s) => s.items);

  const editingItem = useMemo(
    () => (editingItemId ? items.find((i) => i.id === editingItemId) : null),
    [editingItemId, items]
  );
  const visualTransforms = useVisualTransforms(editingItem ? [editingItem] : [], projectSize);

  const coordParams = useMemo((): CoordinateParams | null => {
    if (!containerRect) return null;
    return { containerRect, playerSize, projectSize, zoom };
  }, [containerRect, playerSize, projectSize, zoom]);

  const itemTransform = useMemo((): Transform | null => {
    // Shape pen mode: use full canvas as the coordinate space
    if (shapePenMode) {
      return {
        x: 0, y: 0,
        width: projectSize.width, height: projectSize.height,
        rotation: 0, opacity: 1, cornerRadius: 0,
      };
    }
    if (!editingItem) return null;
    const resolved = visualTransforms.get(editingItem.id);
    if (!resolved) return null;
    return {
      x: resolved.x,
      y: resolved.y,
      width: resolved.width,
      height: resolved.height,
      rotation: resolved.rotation,
      opacity: resolved.opacity,
      cornerRadius: resolved.cornerRadius,
    };
  }, [editingItem, projectSize, shapePenMode, visualTransforms]);

  if (!isEditing || !coordParams || !itemTransform) return null;

  return (
    <MaskEditorOverlay
      coordParams={coordParams}
      playerSize={playerSize}
      itemTransform={itemTransform}
    />
  );
});
