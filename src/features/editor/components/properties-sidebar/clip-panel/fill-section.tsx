import { useCallback, useMemo } from 'react';
import { Droplet, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { TimelineItem } from '@/types/timeline';
import type { TransformProperties, CanvasSettings } from '@/types/transform';
import { useGizmoStore } from '@/features/preview/stores/gizmo-store';
import {
  resolveTransform,
  getSourceDimensions,
} from '@/lib/remotion/utils/transform-resolver';
import {
  PropertySection,
  PropertyRow,
  SliderInput,
} from '../components';

interface FillSectionProps {
  items: TimelineItem[];
  canvas: CanvasSettings;
  onTransformChange: (ids: string[], updates: Partial<TransformProperties>) => void;
}

type MixedValue = number | 'mixed';

/**
 * Get a value from items, returning 'mixed' if they differ.
 */
function getMixedValue(
  items: TimelineItem[],
  canvas: CanvasSettings,
  getter: (resolved: ReturnType<typeof resolveTransform>) => number
): MixedValue {
  if (items.length === 0) return 0;

  const values = items.map((item) => {
    const sourceDimensions = getSourceDimensions(item);
    const resolved = resolveTransform(item, canvas, sourceDimensions);
    return getter(resolved);
  });

  const firstValue = values[0]!; // Safe: items.length > 0 checked above
  return values.every((v) => Math.abs(v - firstValue) < 0.01) ? firstValue : 'mixed';
}

/**
 * Fill section - opacity and corner radius.
 */
export function FillSection({
  items,
  canvas,
  onTransformChange,
}: FillSectionProps) {
  const itemIds = useMemo(() => items.map((item) => item.id), [items]);

  // Gizmo store for live preview
  const setPropertiesPreview = useGizmoStore((s) => s.setPropertiesPreview);
  const clearPropertiesPreview = useGizmoStore((s) => s.clearPropertiesPreview);

  // Get current values (opacity is 0-1, display as 0-100%)
  const opacityRaw = getMixedValue(items, canvas, (r) => r.opacity);
  const opacity = opacityRaw === 'mixed' ? 'mixed' : Math.round(opacityRaw * 100);
  const cornerRadius = getMixedValue(items, canvas, (r) => r.cornerRadius);

  // Live preview for opacity (during drag)
  const handleOpacityLiveChange = useCallback(
    (value: number) => {
      const previews: Record<string, { opacity: number }> = {};
      items.forEach((item) => {
        previews[item.id] = { opacity: value / 100 };
      });
      setPropertiesPreview(previews);
    },
    [items, setPropertiesPreview]
  );

  // Commit opacity (on mouse up)
  const handleOpacityChange = useCallback(
    (value: number) => {
      onTransformChange(itemIds, { opacity: value / 100 });
      queueMicrotask(() => clearPropertiesPreview());
    },
    [itemIds, onTransformChange, clearPropertiesPreview]
  );

  // Live preview for corner radius (during drag)
  const handleCornerRadiusLiveChange = useCallback(
    (value: number) => {
      const previews: Record<string, { cornerRadius: number }> = {};
      items.forEach((item) => {
        previews[item.id] = { cornerRadius: value };
      });
      setPropertiesPreview(previews);
    },
    [items, setPropertiesPreview]
  );

  // Commit corner radius (on mouse up)
  const handleCornerRadiusChange = useCallback(
    (value: number) => {
      onTransformChange(itemIds, { cornerRadius: value });
      queueMicrotask(() => clearPropertiesPreview());
    },
    [itemIds, onTransformChange, clearPropertiesPreview]
  );

  // Reset opacity to 100%
  const handleResetOpacity = useCallback(() => {
    const tolerance = 0.01;
    const needsUpdate = items.some((item) => {
      const sourceDimensions = getSourceDimensions(item);
      const resolved = resolveTransform(item, canvas, sourceDimensions);
      return Math.abs(resolved.opacity - 1) > tolerance;
    });
    if (needsUpdate) {
      onTransformChange(itemIds, { opacity: 1 });
    }
  }, [items, itemIds, onTransformChange, canvas]);

  // Reset corner radius to 0
  const handleResetCornerRadius = useCallback(() => {
    const tolerance = 0.5;
    const needsUpdate = items.some((item) => {
      const sourceDimensions = getSourceDimensions(item);
      const resolved = resolveTransform(item, canvas, sourceDimensions);
      return resolved.cornerRadius > tolerance;
    });
    if (needsUpdate) {
      onTransformChange(itemIds, { cornerRadius: 0 });
    }
  }, [items, itemIds, onTransformChange, canvas]);

  return (
    <PropertySection title="Fill" icon={Droplet} defaultOpen={true}>
      {/* Opacity */}
      <PropertyRow label="Opacity">
        <div className="flex items-center gap-1 flex-1">
          <SliderInput
            value={opacity}
            onChange={handleOpacityChange}
            onLiveChange={handleOpacityLiveChange}
            min={0}
            max={100}
            step={1}
            unit="%"
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 flex-shrink-0"
            onClick={handleResetOpacity}
            title="Reset to 100%"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </Button>
        </div>
      </PropertyRow>

      {/* Corner Radius */}
      <PropertyRow label="Radius">
        <div className="flex items-center gap-1 flex-1">
          <SliderInput
            value={cornerRadius}
            onChange={handleCornerRadiusChange}
            onLiveChange={handleCornerRadiusLiveChange}
            min={0}
            max={1000}
            step={1}
            unit="px"
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 flex-shrink-0"
            onClick={handleResetCornerRadius}
            title="Reset to 0"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </Button>
        </div>
      </PropertyRow>
    </PropertySection>
  );
}
