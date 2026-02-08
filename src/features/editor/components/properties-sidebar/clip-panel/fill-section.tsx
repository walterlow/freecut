import { useCallback, useMemo, memo } from 'react';
import { Droplet, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { TimelineItem } from '@/types/timeline';
import type { TransformProperties, CanvasSettings } from '@/types/transform';
import { useGizmoStore } from '@/features/preview/stores/gizmo-store';
import { useThrottledFrame } from '@/features/preview/hooks/use-throttled-frame';
import { useTimelineStore } from '@/features/timeline/stores/timeline-store';
import {
  resolveTransform,
  getSourceDimensions,
} from '@/lib/composition-runtime/utils/transform-resolver';
import { resolveAnimatedTransform } from '@/features/keyframes/utils/animated-transform-resolver';
import { autoKeyframeProperty } from '@/features/keyframes/utils/auto-keyframe';
import {
  PropertySection,
  PropertyRow,
  NumberInput,
} from '../components';
import { KeyframeToggle } from '@/features/keyframes/components/keyframe-toggle';

interface FillSectionProps {
  items: TimelineItem[];
  canvas: CanvasSettings;
  onTransformChange: (ids: string[], updates: Partial<TransformProperties>) => void;
}

type MixedValue = number | 'mixed';

/**
 * Fill section - opacity and corner radius.
 * Memoized to prevent re-renders when props haven't changed.
 */
export const FillSection = memo(function FillSection({
  items,
  canvas,
  onTransformChange,
}: FillSectionProps) {
  const itemIds = useMemo(() => items.map((item) => item.id), [items]);

  // Get current playhead frame for keyframe animation (throttled to reduce re-renders)
  const currentFrame = useThrottledFrame();

  // Get keyframes for all selected items
  const allKeyframes = useTimelineStore((s) => s.keyframes);

  // Gizmo store for live preview
  const setTransformPreview = useGizmoStore((s) => s.setTransformPreview);
  const clearPreview = useGizmoStore((s) => s.clearPreview);

  // Get current values with keyframe animation applied
  // Opacity is 0-1, display as 0-100%
  const { opacityRaw, cornerRadius } = useMemo(() => {
    if (items.length === 0) {
      return { opacityRaw: 1 as MixedValue, cornerRadius: 0 as MixedValue };
    }

    const resolvedValues = items.map((item) => {
      const sourceDimensions = getSourceDimensions(item);
      const baseResolved = resolveTransform(item, canvas, sourceDimensions);

      // Apply keyframe animation if item has keyframes
      const itemKeyframes = allKeyframes.find((k) => k.itemId === item.id);
      if (itemKeyframes) {
        const relativeFrame = currentFrame - item.from;
        return resolveAnimatedTransform(baseResolved, itemKeyframes, relativeFrame);
      }

      return baseResolved;
    });

    const getVal = (getter: (r: ReturnType<typeof resolveTransform>) => number): MixedValue => {
      const values = resolvedValues.map(getter);
      const firstValue = values[0]!;
      return values.every((v) => Math.abs(v - firstValue) < 0.01) ? firstValue : 'mixed';
    };

    return {
      opacityRaw: getVal((r) => r.opacity),
      cornerRadius: getVal((r) => r.cornerRadius),
    };
  }, [items, canvas, allKeyframes, currentFrame]);

  const opacity = opacityRaw === 'mixed' ? 'mixed' : Math.round(opacityRaw * 100);

  // Get keyframe actions for auto-keyframing
  const addKeyframe = useTimelineStore((s) => s.addKeyframe);
  const updateKeyframe = useTimelineStore((s) => s.updateKeyframe);

  // Helper: Check if opacity has keyframes and auto-keyframe on value change
  const autoKeyframeOpacity = useCallback(
    (itemId: string, value: number): boolean => {
      const item = items.find((i) => i.id === itemId);
      if (!item) return false;

      const itemKeyframes = allKeyframes.find((k) => k.itemId === itemId);
      return autoKeyframeProperty(item, itemKeyframes, 'opacity', value, currentFrame, addKeyframe, updateKeyframe);
    },
    [items, allKeyframes, currentFrame, addKeyframe, updateKeyframe]
  );

  // Helper: Check if cornerRadius has keyframes and auto-keyframe on value change
  const autoKeyframeCornerRadius = useCallback(
    (itemId: string, value: number): boolean => {
      const item = items.find((i) => i.id === itemId);
      if (!item) return false;

      const itemKeyframes = allKeyframes.find((k) => k.itemId === itemId);
      return autoKeyframeProperty(item, itemKeyframes, 'cornerRadius', value, currentFrame, addKeyframe, updateKeyframe);
    },
    [items, allKeyframes, currentFrame, addKeyframe, updateKeyframe]
  );

  // Live preview for opacity (during drag)
  const handleOpacityLiveChange = useCallback(
    (value: number) => {
      const previews: Record<string, { opacity: number }> = {};
      items.forEach((item) => {
        previews[item.id] = { opacity: value / 100 };
      });
      setTransformPreview(previews);
    },
    [items, setTransformPreview]
  );

  // Commit opacity (on mouse up, with auto-keyframe support)
  const handleOpacityChange = useCallback(
    (value: number) => {
      const opacityValue = value / 100; // Convert from 0-100 to 0-1

      let allHandled = true;
      for (const itemId of itemIds) {
        if (!autoKeyframeOpacity(itemId, opacityValue)) {
          allHandled = false;
        }
      }
      if (!allHandled) {
        onTransformChange(itemIds, { opacity: opacityValue });
      }
      queueMicrotask(() => clearPreview());
    },
    [itemIds, onTransformChange, clearPreview, autoKeyframeOpacity]
  );

  // Live preview for corner radius (during drag)
  const handleCornerRadiusLiveChange = useCallback(
    (value: number) => {
      const previews: Record<string, { cornerRadius: number }> = {};
      items.forEach((item) => {
        previews[item.id] = { cornerRadius: value };
      });
      setTransformPreview(previews);
    },
    [items, setTransformPreview]
  );

  // Commit corner radius (on mouse up, with auto-keyframe support)
  const handleCornerRadiusChange = useCallback(
    (value: number) => {
      let allHandled = true;
      for (const itemId of itemIds) {
        if (!autoKeyframeCornerRadius(itemId, value)) {
          allHandled = false;
        }
      }
      if (!allHandled) {
        onTransformChange(itemIds, { cornerRadius: value });
      }
      queueMicrotask(() => clearPreview());
    },
    [itemIds, onTransformChange, clearPreview, autoKeyframeCornerRadius]
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
        <div className="flex items-center gap-1 w-full">
          <KeyframeToggle
            itemIds={itemIds}
            property="opacity"
            currentValue={opacityRaw === 'mixed' ? 1 : opacityRaw}
          />
          <NumberInput
            value={opacity}
            onChange={handleOpacityChange}
            onLiveChange={handleOpacityLiveChange}
            min={0}
            max={100}
            step={1}
            unit="%"
            className="flex-1 min-w-0"
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
        <div className="flex items-center gap-1 w-full">
          <KeyframeToggle
            itemIds={itemIds}
            property="cornerRadius"
            currentValue={cornerRadius === 'mixed' ? 0 : cornerRadius}
          />
          <NumberInput
            value={cornerRadius}
            onChange={handleCornerRadiusChange}
            onLiveChange={handleCornerRadiusLiveChange}
            min={0}
            max={1000}
            step={1}
            unit="px"
            className="flex-1 min-w-0"
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
});
