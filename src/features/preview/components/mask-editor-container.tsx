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
import { resolveTransform, getSourceDimensions } from '@/features/preview/deps/composition-runtime';

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

  const items = useItemsStore((s) => s.items);

  const editingItem = useMemo(
    () => (editingItemId ? items.find((i) => i.id === editingItemId) : null),
    [editingItemId, items]
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
    <MaskEditorOverlay
      coordParams={coordParams}
      playerSize={playerSize}
      itemTransform={itemTransform}
    />
  );
});
