import { useCallback, useMemo, memo } from 'react';
import { Droplet, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { TimelineItem } from '@/types/timeline';
import type { BlendMode } from '@/types/blend-modes';
import { BLEND_MODE_GROUPS, BLEND_MODE_LABELS } from '@/types/blend-modes';
import type { TransformProperties, CanvasSettings } from '@/types/transform';
import { useGizmoStore, useThrottledFrame } from '@/features/editor/deps/preview';
import { useTimelineStore } from '@/features/editor/deps/timeline-store';
import {
  resolveTransform,
  getSourceDimensions,
} from '@/features/editor/deps/composition-runtime';
import {
  getAutoKeyframeOperation,
  type AutoKeyframeOperation,
  resolveAnimatedTransform,
  KeyframeToggle,
} from '@/features/editor/deps/keyframes';
import {
  PropertySection,
  PropertyRow,
  NumberInput,
  SliderInput,
} from '../components';

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

  // Item update for non-transform properties (blend mode)
  const updateItem = useTimelineStore((s) => s.updateItem);

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

  // Get batched keyframe action for auto-keyframing
  const applyAutoKeyframeOperations = useTimelineStore((s) => s.applyAutoKeyframeOperations);

  // Helper: Check if opacity has keyframes and auto-keyframe on value change
  const autoKeyframeOpacity = useCallback(
    (itemId: string, value: number): AutoKeyframeOperation | null => {
      const item = items.find((i) => i.id === itemId);
      if (!item) return null;

      const itemKeyframes = allKeyframes.find((k) => k.itemId === itemId);
      return getAutoKeyframeOperation(item, itemKeyframes, 'opacity', value, currentFrame);
    },
    [items, allKeyframes, currentFrame]
  );

  // Helper: Check if cornerRadius has keyframes and auto-keyframe on value change
  const autoKeyframeCornerRadius = useCallback(
    (itemId: string, value: number): AutoKeyframeOperation | null => {
      const item = items.find((i) => i.id === itemId);
      if (!item) return null;

      const itemKeyframes = allKeyframes.find((k) => k.itemId === itemId);
      return getAutoKeyframeOperation(item, itemKeyframes, 'cornerRadius', value, currentFrame);
    },
    [items, allKeyframes, currentFrame]
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
      const autoOps: AutoKeyframeOperation[] = [];
      for (const itemId of itemIds) {
        const operation = autoKeyframeOpacity(itemId, opacityValue);
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
        onTransformChange(itemIds, { opacity: opacityValue });
      }
      queueMicrotask(() => clearPreview());
    },
    [itemIds, onTransformChange, clearPreview, autoKeyframeOpacity, applyAutoKeyframeOperations]
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
      const autoOps: AutoKeyframeOperation[] = [];
      for (const itemId of itemIds) {
        const operation = autoKeyframeCornerRadius(itemId, value);
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
        onTransformChange(itemIds, { cornerRadius: value });
      }
      queueMicrotask(() => clearPreview());
    },
    [itemIds, onTransformChange, clearPreview, autoKeyframeCornerRadius, applyAutoKeyframeOperations]
  );

  // Get current blend mode (shared across selected items)
  const blendMode = useMemo(() => {
    if (items.length === 0) return 'normal' as BlendMode;
    const first = items[0]!.blendMode ?? 'normal';
    const allSame = items.every((item) => (item.blendMode ?? 'normal') === first);
    return allSame ? first : ('mixed' as string);
  }, [items]);

  // Handle blend mode change
  const handleBlendModeChange = useCallback(
    (value: string) => {
      for (const id of itemIds) {
        updateItem(id, { blendMode: value as BlendMode });
      }
    },
    [itemIds, updateItem]
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
          <SliderInput
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

      {/* Blend Mode */}
      <PropertyRow label="Blend">
        <Select
          value={blendMode === 'mixed' ? undefined : blendMode}
          onValueChange={handleBlendModeChange}
        >
          <SelectTrigger className="h-7 text-xs flex-1 min-w-0">
            <SelectValue placeholder={blendMode === 'mixed' ? 'Mixed' : 'Normal'} />
          </SelectTrigger>
          <SelectContent>
            {BLEND_MODE_GROUPS.map((group) => (
              <SelectGroup key={group.label}>
                <SelectLabel className="text-[10px] text-muted-foreground">{group.label}</SelectLabel>
                {group.modes.map((mode) => (
                  <SelectItem key={mode} value={mode} className="text-xs">
                    {BLEND_MODE_LABELS[mode]}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
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

