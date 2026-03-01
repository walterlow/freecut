import { useCallback, useMemo, memo } from 'react';
import { Move, RotateCcw, Link2, Link2Off } from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import type { TimelineItem } from '@/types/timeline';
import type { TransformProperties, CanvasSettings } from '@/types/transform';
import { useGizmoStore, useThrottledFrame } from '@/features/editor/deps/preview';
import { useMediaLibraryStore } from '@/features/editor/deps/media-library';
import { useTimelineStore } from '@/features/editor/deps/timeline-store';
import {
  resolveTransform,
  getSourceDimensions,
} from '@/features/editor/deps/composition-runtime';
import {
  getAutoKeyframeOperation as getAutoKeyframeOp,
  type AutoKeyframeOperation,
  resolveAnimatedTransform,
  KeyframeToggle,
} from '@/features/editor/deps/keyframes';
import {
  PropertySection,
  PropertyRow,
  NumberInput,
  AlignmentButtons,
  type AlignmentType,
} from '../components';

interface LayoutSectionProps {
  items: TimelineItem[];
  canvas: CanvasSettings;
  onTransformChange: (ids: string[], updates: Partial<TransformProperties>) => void;
  aspectLocked: boolean;
  onAspectLockToggle: () => void;
}

type MixedValue = number | 'mixed';

/** Common transform properties that both gizmo and resolved transforms share */
type TransformValues = {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
};

/**
 * Layout section - position, dimensions, rotation, alignment.
 * Memoized to prevent re-renders when props haven't changed.
 */
export const LayoutSection = memo(function LayoutSection({
  items,
  canvas,
  onTransformChange,
  aspectLocked,
  onAspectLockToggle,
}: LayoutSectionProps) {
  const itemIds = useMemo(() => items.map((item) => item.id), [items]);

  // Get current playhead frame for keyframe animation (throttled to reduce re-renders)
  const currentFrame = useThrottledFrame();

  // Get keyframes for all selected items
  const allKeyframes = useTimelineStore((s) => s.keyframes);

  // Gizmo store for live preview (both for properties panel and gizmo drag sync)
  const setTransformPreview = useGizmoStore((s) => s.setTransformPreview);
  const clearPreview = useGizmoStore((s) => s.clearPreview);
  const activeGizmo = useGizmoStore((s) => s.activeGizmo);
  const previewTransform = useGizmoStore((s) => s.previewTransform);

  // Build gizmo preview context if gizmo is active for one of our items
  const gizmoPreview = useMemo(() => {
    if (!activeGizmo || !previewTransform) return null;
    // Check if the gizmo's active item is in our selection
    if (!itemIds.includes(activeGizmo.itemId)) return null;
    return {
      itemId: activeGizmo.itemId,
      transform: previewTransform,
    };
  }, [activeGizmo, previewTransform, itemIds]);

  // Resolve transforms once for all items, applying keyframe animation and
  // gizmo preview overrides. Reused by mixed-value fields and align/distribute.
  const resolvedTransformsByItem = useMemo(() => {
    const resolved = new Map<string, TransformValues>();
    for (const item of items) {
      const transform = (() => {
        if (gizmoPreview && gizmoPreview.itemId === item.id) {
          return gizmoPreview.transform;
        }
        const sourceDimensions = getSourceDimensions(item);
        const baseResolved = resolveTransform(item, canvas, sourceDimensions);
        const itemKeyframes = allKeyframes.find((k) => k.itemId === item.id);
        if (!itemKeyframes) return baseResolved;
        const relativeFrame = currentFrame - item.from;
        return resolveAnimatedTransform(baseResolved, itemKeyframes, relativeFrame);
      })();

      resolved.set(item.id, {
        x: transform.x,
        y: transform.y,
        width: transform.width,
        height: transform.height,
        rotation: transform.rotation,
      });
    }
    return resolved;
  }, [items, canvas, gizmoPreview, allKeyframes, currentFrame]);

  // Memoize all transform values at once to avoid repeated iterations.
  const { x, y, width, height, rotation } = useMemo(() => {
    if (items.length === 0) {
      return { x: 0, y: 0, width: 0, height: 0, rotation: 0 };
    }

    const resolvedValues = items
      .map((item) => resolvedTransformsByItem.get(item.id))
      .filter((value): value is TransformValues => value !== undefined);

    if (resolvedValues.length === 0) {
      return { x: 0, y: 0, width: 0, height: 0, rotation: 0 };
    }

    const getValue = (getter: (resolved: TransformValues) => number): MixedValue => {
      const values = resolvedValues.map(getter);
      const firstValue = values[0]!;
      return values.every((v) => Math.abs(v - firstValue) < 0.1) ? firstValue : 'mixed';
    };

    return {
      x: getValue((r) => r.x),
      y: getValue((r) => r.y),
      width: getValue((r) => r.width),
      height: getValue((r) => r.height),
      rotation: getValue((r) => r.rotation),
    };
  }, [items, resolvedTransformsByItem]);

  // Store current aspect ratio for linked dimensions
  const currentAspectRatio = useMemo(() => {
    if (width === 'mixed' || height === 'mixed') return 1;
    return height > 0 ? width / height : 1;
  }, [width, height]);

  // Get batched keyframe action for auto-keyframing
  const applyAutoKeyframeOperations = useTimelineStore((s) => s.applyAutoKeyframeOperations);
  const updateItemsTransformMap = useTimelineStore((s) => s.updateItemsTransformMap);

  // Helper: Build auto-keyframe operations for properties that are already animated.
  const getAutoKeyframeOperation = useCallback(
    (
      itemId: string,
      property: 'x' | 'y' | 'width' | 'height' | 'rotation' | 'opacity',
      value: number
    ): AutoKeyframeOperation | null => {
      const item = items.find((i) => i.id === itemId);
      if (!item) return null;

      const itemKeyframes = allKeyframes.find((k) => k.itemId === itemId);
      return getAutoKeyframeOp(item, itemKeyframes, property, value, currentFrame);
    },
    [items, allKeyframes, currentFrame]
  );

  // Live preview for X position (during scrub)
  const handleXLiveChange = useCallback(
    (value: number) => {
      const previews: Record<string, { x: number }> = {};
      items.forEach((item) => {
        previews[item.id] = { x: value };
      });
      setTransformPreview(previews);
    },
    [items, setTransformPreview]
  );

  // Commit X position (with auto-keyframe support)
  const handleXChange = useCallback(
    (value: number) => {
      // Try auto-keyframe first for items with keyframes
      let allHandled = true;
      const autoOps: AutoKeyframeOperation[] = [];
      for (const itemId of itemIds) {
        const operation = getAutoKeyframeOperation(itemId, 'x', value);
        if (operation) {
          autoOps.push(operation);
        } else {
          allHandled = false;
        }
      }
      if (autoOps.length > 0) {
        applyAutoKeyframeOperations(autoOps);
      }
      // Fall back to base transform for items without keyframes
      if (!allHandled) {
        onTransformChange(itemIds, { x: value });
      }
      queueMicrotask(() => clearPreview());
    },
    [itemIds, onTransformChange, clearPreview, getAutoKeyframeOperation, applyAutoKeyframeOperations]
  );

  // Live preview for Y position (during scrub)
  const handleYLiveChange = useCallback(
    (value: number) => {
      const previews: Record<string, { y: number }> = {};
      items.forEach((item) => {
        previews[item.id] = { y: value };
      });
      setTransformPreview(previews);
    },
    [items, setTransformPreview]
  );

  // Commit Y position (with auto-keyframe support)
  const handleYChange = useCallback(
    (value: number) => {
      let allHandled = true;
      const autoOps: AutoKeyframeOperation[] = [];
      for (const itemId of itemIds) {
        const operation = getAutoKeyframeOperation(itemId, 'y', value);
        if (operation) {
          autoOps.push(operation);
        } else {
          allHandled = false;
        }
      }
      if (autoOps.length > 0) {
        applyAutoKeyframeOperations(autoOps);
      }
      if (!allHandled) {
        onTransformChange(itemIds, { y: value });
      }
      queueMicrotask(() => clearPreview());
    },
    [itemIds, onTransformChange, clearPreview, getAutoKeyframeOperation, applyAutoKeyframeOperations]
  );

  // Live preview for width (during scrub)
  const handleWidthLiveChange = useCallback(
    (value: number) => {
      const previews: Record<string, { width: number; height?: number }> = {};
      items.forEach((item) => {
        if (aspectLocked && height !== 'mixed') {
          const newHeight = Math.round(value / currentAspectRatio);
          previews[item.id] = { width: value, height: newHeight };
        } else {
          previews[item.id] = { width: value };
        }
      });
      setTransformPreview(previews);
    },
    [items, setTransformPreview, aspectLocked, height, currentAspectRatio]
  );

  // Commit width (with auto-keyframe support)
  const handleWidthChange = useCallback(
    (value: number) => {
      const newHeight = aspectLocked && height !== 'mixed' ? Math.round(value / currentAspectRatio) : null;

      let allHandled = true;
      const autoOps: AutoKeyframeOperation[] = [];
      for (const itemId of itemIds) {
        const widthOperation = getAutoKeyframeOperation(itemId, 'width', value);
        const heightOperation = newHeight !== null ? getAutoKeyframeOperation(itemId, 'height', newHeight) : null;
        const widthHandled = Boolean(widthOperation);
        const heightHandled = newHeight !== null ? Boolean(heightOperation) : true;
        if (widthOperation) autoOps.push(widthOperation);
        if (heightOperation) autoOps.push(heightOperation);
        if (!widthHandled || !heightHandled) {
          allHandled = false;
        }
      }
      if (autoOps.length > 0) {
        applyAutoKeyframeOperations(autoOps);
      }
      if (!allHandled) {
        if (newHeight !== null) {
          onTransformChange(itemIds, { width: value, height: newHeight });
        } else {
          onTransformChange(itemIds, { width: value });
        }
      }
      queueMicrotask(() => clearPreview());
    },
    [
      itemIds,
      onTransformChange,
      clearPreview,
      aspectLocked,
      height,
      currentAspectRatio,
      getAutoKeyframeOperation,
      applyAutoKeyframeOperations,
    ]
  );

  // Live preview for height (during scrub)
  const handleHeightLiveChange = useCallback(
    (value: number) => {
      const previews: Record<string, { width?: number; height: number }> = {};
      items.forEach((item) => {
        if (aspectLocked && width !== 'mixed') {
          const newWidth = Math.round(value * currentAspectRatio);
          previews[item.id] = { width: newWidth, height: value };
        } else {
          previews[item.id] = { height: value };
        }
      });
      setTransformPreview(previews);
    },
    [items, setTransformPreview, aspectLocked, width, currentAspectRatio]
  );

  // Commit height (with auto-keyframe support)
  const handleHeightChange = useCallback(
    (value: number) => {
      const newWidth = aspectLocked && width !== 'mixed' ? Math.round(value * currentAspectRatio) : null;

      let allHandled = true;
      const autoOps: AutoKeyframeOperation[] = [];
      for (const itemId of itemIds) {
        const heightOperation = getAutoKeyframeOperation(itemId, 'height', value);
        const widthOperation = newWidth !== null ? getAutoKeyframeOperation(itemId, 'width', newWidth) : null;
        const heightHandled = Boolean(heightOperation);
        const widthHandled = newWidth !== null ? Boolean(widthOperation) : true;
        if (heightOperation) autoOps.push(heightOperation);
        if (widthOperation) autoOps.push(widthOperation);
        if (!heightHandled || !widthHandled) {
          allHandled = false;
        }
      }
      if (autoOps.length > 0) {
        applyAutoKeyframeOperations(autoOps);
      }
      if (!allHandled) {
        if (newWidth !== null) {
          onTransformChange(itemIds, { width: newWidth, height: value });
        } else {
          onTransformChange(itemIds, { height: value });
        }
      }
      queueMicrotask(() => clearPreview());
    },
    [
      itemIds,
      onTransformChange,
      clearPreview,
      aspectLocked,
      width,
      currentAspectRatio,
      getAutoKeyframeOperation,
      applyAutoKeyframeOperations,
    ]
  );

  // Live preview for rotation (during drag)
  const handleRotationLiveChange = useCallback(
    (value: number) => {
      const previews: Record<string, { rotation: number }> = {};
      items.forEach((item) => {
        previews[item.id] = { rotation: value };
      });
      setTransformPreview(previews);
    },
    [items, setTransformPreview]
  );

  // Commit rotation (on mouse up, with auto-keyframe support)
  const handleRotationChange = useCallback(
    (value: number) => {
      let allHandled = true;
      const autoOps: AutoKeyframeOperation[] = [];
      for (const itemId of itemIds) {
        const operation = getAutoKeyframeOperation(itemId, 'rotation', value);
        if (operation) {
          autoOps.push(operation);
        } else {
          allHandled = false;
        }
      }
      if (autoOps.length > 0) {
        applyAutoKeyframeOperations(autoOps);
      }
      if (!allHandled) {
        onTransformChange(itemIds, { rotation: value });
      }
      queueMicrotask(() => clearPreview());
    },
    [itemIds, onTransformChange, clearPreview, getAutoKeyframeOperation, applyAutoKeyframeOperations]
  );

  // Get media items for fallback source dimensions lookup
  const mediaItems = useMediaLibraryStore((s) => s.mediaItems);

  // Reset scale to source dimensions (1:1 scale)
  // For shapes: reset to 1:1 aspect ratio (square based on smaller dimension)
  const handleResetScale = useCallback(() => {
    const tolerance = 0.5;

    // For each item, reset to its source dimensions
    items.forEach((item) => {
      // Get current dimensions
      const sourceDimensions = getSourceDimensions(item);
      const resolved = resolveTransform(item, canvas, sourceDimensions);

      // For shapes: reset to 1:1 aspect ratio
      if (item.type === 'shape' || item.type === 'text') {
        const size = Math.min(resolved.width, resolved.height);
        const updates: Partial<TransformProperties> = {};

        if (Math.abs(resolved.width - size) > tolerance) {
          updates.width = size;
        }
        if (Math.abs(resolved.height - size) > tolerance) {
          updates.height = size;
        }

        if (Object.keys(updates).length > 0) {
          onTransformChange([item.id], updates);
        }
        return;
      }

      // First try to get source dimensions from the item itself
      let source = getSourceDimensions(item);

      // Fallback: look up dimensions from media library if item has mediaId
      if (!source && item.mediaId) {
        const media = mediaItems.find((m) => m.id === item.mediaId);
        if (media && media.width && media.height) {
          source = { width: media.width, height: media.height };
        }
      }

      if (!source) return;

      // Only update if dimensions actually changed
      const updates: Partial<TransformProperties> = {};
      if (Math.abs(resolved.width - source.width) > tolerance) {
        updates.width = source.width;
      }
      if (Math.abs(resolved.height - source.height) > tolerance) {
        updates.height = source.height;
      }

      // Skip if no actual changes
      if (Object.keys(updates).length === 0) return;

      onTransformChange([item.id], updates);
    });
  }, [items, onTransformChange, mediaItems, canvas]);

  // Reset position to center (x=0, y=0)
  const handleResetPosition = useCallback(() => {
    const tolerance = 0.5;
    items.forEach((item) => {
      const sourceDimensions = getSourceDimensions(item);
      const resolved = resolveTransform(item, canvas, sourceDimensions);

      const updates: Partial<TransformProperties> = {};
      if (Math.abs(resolved.x) > tolerance) updates.x = 0;
      if (Math.abs(resolved.y) > tolerance) updates.y = 0;

      if (Object.keys(updates).length === 0) return;
      onTransformChange([item.id], updates);
    });
  }, [items, onTransformChange, canvas]);

  // Reset rotation to 0°
  const handleResetRotation = useCallback(() => {
    const tolerance = 0.5;
    items.forEach((item) => {
      const sourceDimensions = getSourceDimensions(item);
      const resolved = resolveTransform(item, canvas, sourceDimensions);

      if (Math.abs(resolved.rotation) <= tolerance) return;
      onTransformChange([item.id], { rotation: 0 });
    });
  }, [items, onTransformChange, canvas]);

  const handleAlign = useCallback(
    (alignment: AlignmentType) => {
      const tolerance = 0.5;
      const nextTransforms = new Map<string, Partial<TransformProperties>>();
      const entries = items
        .map((item) => {
          const resolved = resolvedTransformsByItem.get(item.id);
          return resolved ? { itemId: item.id, ...resolved } : null;
        })
        .filter((entry): entry is {
          itemId: string;
          x: number;
          y: number;
          width: number;
          height: number;
          rotation: number;
        } => entry !== null);

      if (entries.length === 0) return;

      if (alignment === 'distribute-h' || alignment === 'distribute-v') {
        if (entries.length < 3) return;
        const axis = alignment === 'distribute-h' ? 'x' : 'y';
        const sorted = [...entries].sort((a, b) => a[axis] - b[axis]);
        const first = sorted[0]!;
        const last = sorted[sorted.length - 1]!;
        const step = (last[axis] - first[axis]) / (sorted.length - 1);

        for (let i = 1; i < sorted.length - 1; i++) {
          const entry = sorted[i]!;
          const target = first[axis] + (step * i);
          if (Math.abs(target - entry[axis]) <= tolerance) continue;
          if (axis === 'x') {
            nextTransforms.set(entry.itemId, { x: target });
          } else {
            nextTransforms.set(entry.itemId, { y: target });
          }
        }
      } else {
        for (const entry of entries) {
          let newX: number | undefined;
          let newY: number | undefined;

          switch (alignment) {
            case 'left':
              newX = -canvas.width / 2 + entry.width / 2;
              break;
            case 'center-h':
              newX = 0;
              break;
            case 'right':
              newX = canvas.width / 2 - entry.width / 2;
              break;
            case 'top':
              newY = -canvas.height / 2 + entry.height / 2;
              break;
            case 'center-v':
              newY = 0;
              break;
            case 'bottom':
              newY = canvas.height / 2 - entry.height / 2;
              break;
            default:
              break;
          }

          const updates: Partial<TransformProperties> = {};
          if (newX !== undefined && Math.abs(newX - entry.x) > tolerance) {
            updates.x = newX;
          }
          if (newY !== undefined && Math.abs(newY - entry.y) > tolerance) {
            updates.y = newY;
          }
          if (Object.keys(updates).length > 0) {
            nextTransforms.set(entry.itemId, updates);
          }
        }
      }

      if (nextTransforms.size === 0) return;
      updateItemsTransformMap(nextTransforms, { operation: 'move' });
    },
    [items, resolvedTransformsByItem, canvas, updateItemsTransformMap]
  );

  return (
    <PropertySection title="Layout" icon={Move} defaultOpen={true}>
      {/* Alignment buttons */}
      <AlignmentButtons onAlign={handleAlign} />

      <Separator className="my-2" />

      {/* Position */}
      <PropertyRow label="Position">
        <div className="flex items-start gap-1 w-full">
          <div className="grid grid-cols-2 gap-1 flex-1">
            <div className="flex items-center gap-0.5">
              <KeyframeToggle
                itemIds={itemIds}
                property="x"
                currentValue={x === 'mixed' ? 0 : x}
              />
              <NumberInput
                value={x}
                onChange={handleXChange}
                onLiveChange={handleXLiveChange}
                label="X"
                unit="px"
                step={1}
                className="flex-1"
              />
            </div>
            <div className="flex items-center gap-0.5">
              <KeyframeToggle
                itemIds={itemIds}
                property="y"
                currentValue={y === 'mixed' ? 0 : y}
              />
              <NumberInput
                value={y}
                onChange={handleYChange}
                onLiveChange={handleYLiveChange}
                label="Y"
                unit="px"
                step={1}
                className="flex-1"
              />
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 flex-shrink-0"
            onClick={handleResetPosition}
            title="Reset to center"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </Button>
        </div>
      </PropertyRow>

      {/* Dimensions */}
      <PropertyRow label="Size">
        <div className="flex items-center gap-1 w-full">
          <KeyframeToggle
            itemIds={itemIds}
            property="width"
            currentValue={width === 'mixed' ? 100 : width}
          />
          <NumberInput
            value={width}
            onChange={handleWidthChange}
            onLiveChange={handleWidthLiveChange}
            label="W"
            unit="px"
            min={1}
            max={7680}
            step={1}
            className="flex-1 min-w-0"
          />
          <Button
            variant="ghost"
            size="icon"
            className={`h-7 w-7 flex-shrink-0 ${aspectLocked ? 'text-primary' : ''}`}
            onClick={onAspectLockToggle}
            title={aspectLocked ? 'Unlock aspect ratio' : 'Lock aspect ratio'}
          >
            {aspectLocked ? (
              <Link2 className="w-3.5 h-3.5" />
            ) : (
              <Link2Off className="w-3.5 h-3.5" />
            )}
          </Button>
          <KeyframeToggle
            itemIds={itemIds}
            property="height"
            currentValue={height === 'mixed' ? 100 : height}
          />
          <NumberInput
            value={height}
            onChange={handleHeightChange}
            onLiveChange={handleHeightLiveChange}
            label="H"
            unit="px"
            min={1}
            max={7680}
            step={1}
            className="flex-1 min-w-0"
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 flex-shrink-0"
            onClick={handleResetScale}
            title="Reset to original size"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </Button>
        </div>
      </PropertyRow>

      {/* Rotation */}
      <PropertyRow label="Rotation">
        <div className="flex items-center gap-1 w-full">
          <KeyframeToggle
            itemIds={itemIds}
            property="rotation"
            currentValue={rotation === 'mixed' ? 0 : rotation}
          />
          <NumberInput
            value={rotation}
            onChange={handleRotationChange}
            onLiveChange={handleRotationLiveChange}
            min={-180}
            max={180}
            step={1}
            unit="°"
            className="flex-1 min-w-0"
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 flex-shrink-0"
            onClick={handleResetRotation}
            title="Reset rotation"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </Button>
        </div>
      </PropertyRow>
    </PropertySection>
  );
});
