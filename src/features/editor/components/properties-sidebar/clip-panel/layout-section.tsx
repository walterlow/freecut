import { useCallback, useMemo } from 'react';
import { Move, RotateCcw } from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import type { TimelineItem } from '@/types/timeline';
import type { TransformProperties, CanvasSettings } from '@/types/transform';
import { useGizmoStore } from '@/features/preview/stores/gizmo-store';
import { useMediaLibraryStore } from '@/features/media-library/stores/media-library-store';
import {
  resolveTransform,
  getSourceDimensions,
} from '@/lib/remotion/utils/transform-resolver';
import {
  PropertySection,
  PropertyRow,
  NumberInput,
  SliderInput,
  LinkedDimensions,
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
 * Get a value from items, returning 'mixed' if they differ.
 * When gizmo is active for the item, use the preview transform values.
 */
function getMixedValue(
  items: TimelineItem[],
  canvas: CanvasSettings,
  getter: (resolved: TransformValues) => number,
  gizmoPreview?: { itemId: string; transform: TransformValues } | null
): MixedValue {
  if (items.length === 0) return 0;

  const values = items.map((item) => {
    // If gizmo is active for this item, use the preview transform
    if (gizmoPreview && gizmoPreview.itemId === item.id) {
      return getter(gizmoPreview.transform);
    }
    const sourceDimensions = getSourceDimensions(item);
    const resolved = resolveTransform(item, canvas, sourceDimensions);
    return getter(resolved);
  });

  const firstValue = values[0]!; // Safe: items.length > 0 checked above
  return values.every((v) => Math.abs(v - firstValue) < 0.1) ? firstValue : 'mixed';
}

/**
 * Layout section - position, dimensions, rotation, alignment.
 */
export function LayoutSection({
  items,
  canvas,
  onTransformChange,
  aspectLocked,
  onAspectLockToggle,
}: LayoutSectionProps) {
  const itemIds = useMemo(() => items.map((item) => item.id), [items]);

  // Gizmo store for live preview (both for properties panel and gizmo drag sync)
  const setPropertiesPreview = useGizmoStore((s) => s.setPropertiesPreview);
  const clearPropertiesPreview = useGizmoStore((s) => s.clearPropertiesPreview);
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

  // Get current values (resolved or mixed, with gizmo preview override)
  const x = getMixedValue(items, canvas, (r) => r.x, gizmoPreview);
  const y = getMixedValue(items, canvas, (r) => r.y, gizmoPreview);
  const width = getMixedValue(items, canvas, (r) => r.width, gizmoPreview);
  const height = getMixedValue(items, canvas, (r) => r.height, gizmoPreview);
  const rotation = getMixedValue(items, canvas, (r) => r.rotation, gizmoPreview);

  // Store current aspect ratio for linked dimensions
  const currentAspectRatio = useMemo(() => {
    if (width === 'mixed' || height === 'mixed') return 1;
    return height > 0 ? width / height : 1;
  }, [width, height]);

  // Live preview for X position (during scrub)
  const handleXLiveChange = useCallback(
    (value: number) => {
      const previews: Record<string, { x: number }> = {};
      items.forEach((item) => {
        previews[item.id] = { x: value };
      });
      setPropertiesPreview(previews);
    },
    [items, setPropertiesPreview]
  );

  // Commit X position
  const handleXChange = useCallback(
    (value: number) => {
      onTransformChange(itemIds, { x: value });
      queueMicrotask(() => clearPropertiesPreview());
    },
    [itemIds, onTransformChange, clearPropertiesPreview]
  );

  // Live preview for Y position (during scrub)
  const handleYLiveChange = useCallback(
    (value: number) => {
      const previews: Record<string, { y: number }> = {};
      items.forEach((item) => {
        previews[item.id] = { y: value };
      });
      setPropertiesPreview(previews);
    },
    [items, setPropertiesPreview]
  );

  // Commit Y position
  const handleYChange = useCallback(
    (value: number) => {
      onTransformChange(itemIds, { y: value });
      queueMicrotask(() => clearPropertiesPreview());
    },
    [itemIds, onTransformChange, clearPropertiesPreview]
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
      setPropertiesPreview(previews);
    },
    [items, setPropertiesPreview, aspectLocked, height, currentAspectRatio]
  );

  // Commit width
  const handleWidthChange = useCallback(
    (value: number) => {
      if (aspectLocked && height !== 'mixed') {
        const newHeight = Math.round(value / currentAspectRatio);
        onTransformChange(itemIds, { width: value, height: newHeight });
      } else {
        onTransformChange(itemIds, { width: value });
      }
      queueMicrotask(() => clearPropertiesPreview());
    },
    [itemIds, onTransformChange, clearPropertiesPreview, aspectLocked, height, currentAspectRatio]
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
      setPropertiesPreview(previews);
    },
    [items, setPropertiesPreview, aspectLocked, width, currentAspectRatio]
  );

  // Commit height
  const handleHeightChange = useCallback(
    (value: number) => {
      if (aspectLocked && width !== 'mixed') {
        const newWidth = Math.round(value * currentAspectRatio);
        onTransformChange(itemIds, { width: newWidth, height: value });
      } else {
        onTransformChange(itemIds, { height: value });
      }
      queueMicrotask(() => clearPropertiesPreview());
    },
    [itemIds, onTransformChange, clearPropertiesPreview, aspectLocked, width, currentAspectRatio]
  );

  // Live preview for rotation (during drag)
  const handleRotationLiveChange = useCallback(
    (value: number) => {
      const previews: Record<string, { rotation: number }> = {};
      items.forEach((item) => {
        previews[item.id] = { rotation: value };
      });
      setPropertiesPreview(previews);
    },
    [items, setPropertiesPreview]
  );

  // Commit rotation (on mouse up)
  const handleRotationChange = useCallback(
    (value: number) => {
      onTransformChange(itemIds, { rotation: value });
      queueMicrotask(() => clearPropertiesPreview());
    },
    [itemIds, onTransformChange, clearPropertiesPreview]
  );

  // Get media items for fallback source dimensions lookup
  const mediaItems = useMediaLibraryStore((s) => s.mediaItems);

  // Reset scale to source dimensions (1:1 scale)
  const handleResetScale = useCallback(() => {
    const tolerance = 0.5;

    // For each item, reset to its source dimensions
    items.forEach((item) => {
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

      // Get current dimensions to check if change is needed
      const sourceDimensions = getSourceDimensions(item);
      const resolved = resolveTransform(item, canvas, sourceDimensions);

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
      // Calculate new position based on alignment
      const currentWidth = width === 'mixed' ? canvas.width : width;
      const currentHeight = height === 'mixed' ? canvas.height : height;
      const currentX = x === 'mixed' ? 0 : x;
      const currentY = y === 'mixed' ? 0 : y;

      let newX: number | undefined;
      let newY: number | undefined;

      switch (alignment) {
        case 'left':
          newX = -canvas.width / 2 + currentWidth / 2;
          break;
        case 'center-h':
          newX = 0;
          break;
        case 'right':
          newX = canvas.width / 2 - currentWidth / 2;
          break;
        case 'top':
          newY = -canvas.height / 2 + currentHeight / 2;
          break;
        case 'center-v':
          newY = 0;
          break;
        case 'bottom':
          newY = canvas.height / 2 - currentHeight / 2;
          break;
      }

      // Only update if position actually changed (within tolerance)
      const tolerance = 0.5;
      const updates: Partial<TransformProperties> = {};
      if (newX !== undefined && Math.abs(newX - currentX) > tolerance) {
        updates.x = newX;
      }
      if (newY !== undefined && Math.abs(newY - currentY) > tolerance) {
        updates.y = newY;
      }

      // Skip if no actual changes
      if (Object.keys(updates).length === 0) return;

      onTransformChange(itemIds, updates);
    },
    [itemIds, onTransformChange, x, y, width, height, canvas]
  );

  return (
    <PropertySection title="Layout" icon={Move} defaultOpen={true}>
      {/* Alignment buttons */}
      <AlignmentButtons onAlign={handleAlign} />

      <Separator className="my-2" />

      {/* Position */}
      <PropertyRow label="Position">
        <div className="flex items-start gap-1">
          <div className="grid grid-cols-2 gap-1 flex-1">
            <NumberInput
              value={x}
              onChange={handleXChange}
              onLiveChange={handleXLiveChange}
              label="X"
              unit="px"
              step={1}
            />
            <NumberInput
              value={y}
              onChange={handleYChange}
              onLiveChange={handleYLiveChange}
              label="Y"
              unit="px"
              step={1}
            />
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
        <div className="flex items-start gap-1">
          <LinkedDimensions
            width={width}
            height={height}
            aspectLocked={aspectLocked}
            onWidthChange={handleWidthChange}
            onHeightChange={handleHeightChange}
            onWidthLiveChange={handleWidthLiveChange}
            onHeightLiveChange={handleHeightLiveChange}
            onAspectLockToggle={onAspectLockToggle}
            minWidth={1}
            minHeight={1}
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
        <div className="flex items-center gap-1 flex-1">
          <SliderInput
            value={rotation}
            onChange={handleRotationChange}
            onLiveChange={handleRotationLiveChange}
            min={-180}
            max={180}
            step={1}
            unit="°"
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
}
