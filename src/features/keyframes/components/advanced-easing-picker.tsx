/**
 * Advanced easing picker component.
 * Full-featured easing selection with presets, custom bezier, and spring physics.
 */

import { memo, useState, useCallback, useMemo } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { EasingType, EasingConfig, BezierControlPoints, SpringParameters } from '@/types/keyframe';
import { DEFAULT_BEZIER_POINTS, DEFAULT_SPRING_PARAMS, EASING_LABELS } from '@/types/keyframe';
import {
  EASING_CATEGORIES,
  getPresetsByCategory,
  findMatchingPreset,
  type EasingPreset,
  type EasingCategory,
} from '../constants/easing-presets';
import { BezierCurveEditor, BezierCurvePreview } from './bezier-curve-editor';
import { SpringEditor, SpringCurvePreview } from './spring-editor';

interface AdvancedEasingPickerProps {
  /** Current easing type */
  value: EasingType;
  /** Current easing configuration */
  easingConfig?: EasingConfig;
  /** Callback when easing changes */
  onChange: (type: EasingType, config?: EasingConfig) => void;
  /** Whether the picker is disabled */
  disabled?: boolean;
  /** Additional class name */
  className?: string;
}

/**
 * Advanced easing picker with presets, custom bezier, and spring options.
 */
export const AdvancedEasingPicker = memo(function AdvancedEasingPicker({
  value,
  easingConfig,
  onChange,
  disabled = false,
  className,
}: AdvancedEasingPickerProps) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<string>('presets');

  // Get the current easing config or create one from the type
  const currentConfig = useMemo((): EasingConfig => {
    if (easingConfig) return easingConfig;
    return { type: value };
  }, [value, easingConfig]);

  // Find if current config matches a preset
  const matchingPreset = useMemo(
    () => findMatchingPreset(currentConfig),
    [currentConfig]
  );

  // Get display label
  const displayLabel = useMemo(() => {
    if (matchingPreset) return matchingPreset.name;
    if (value === 'cubic-bezier') return 'Custom Curve';
    if (value === 'spring') return 'Custom Spring';
    return EASING_LABELS[value];
  }, [matchingPreset, value]);

  // Handle preset selection
  const handlePresetSelect = useCallback(
    (preset: EasingPreset) => {
      onChange(preset.config.type, preset.config);
      setOpen(false);
    },
    [onChange]
  );

  // Handle custom bezier change
  const handleBezierChange = useCallback(
    (bezier: BezierControlPoints) => {
      onChange('cubic-bezier', { type: 'cubic-bezier', bezier });
    },
    [onChange]
  );

  // Handle spring change
  const handleSpringChange = useCallback(
    (spring: SpringParameters) => {
      onChange('spring', { type: 'spring', spring });
    },
    [onChange]
  );

  // Get current bezier points
  const currentBezier = useMemo((): BezierControlPoints => {
    if (currentConfig.type === 'cubic-bezier' && currentConfig.bezier) {
      return currentConfig.bezier;
    }
    return DEFAULT_BEZIER_POINTS;
  }, [currentConfig]);

  // Get current spring params
  const currentSpring = useMemo((): SpringParameters => {
    if (currentConfig.type === 'spring' && currentConfig.spring) {
      return currentConfig.spring;
    }
    return DEFAULT_SPRING_PARAMS;
  }, [currentConfig]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          className={cn('w-full justify-start gap-2', className)}
        >
          <EasingThumbnail config={currentConfig} size={20} />
          <span className="truncate">{displayLabel}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="w-full grid grid-cols-3 rounded-none border-b">
            <TabsTrigger value="presets" className="text-xs">
              Presets
            </TabsTrigger>
            <TabsTrigger value="bezier" className="text-xs">
              Custom
            </TabsTrigger>
            <TabsTrigger value="spring" className="text-xs">
              Spring
            </TabsTrigger>
          </TabsList>

          {/* Presets tab */}
          <TabsContent value="presets" className="m-0">
            <ScrollArea className="h-[300px]">
              <div className="p-2 space-y-4">
                {EASING_CATEGORIES.map((category) => (
                  <PresetCategory
                    key={category.id}
                    category={category}
                    selectedPreset={matchingPreset}
                    onSelect={handlePresetSelect}
                  />
                ))}
              </div>
            </ScrollArea>
          </TabsContent>

          {/* Custom bezier tab */}
          <TabsContent value="bezier" className="m-0 p-4">
            <BezierCurveEditor
              value={currentBezier}
              onChange={handleBezierChange}
              width={248}
              height={200}
            />
          </TabsContent>

          {/* Spring tab */}
          <TabsContent value="spring" className="m-0 p-4">
            <SpringEditor
              value={currentSpring}
              onChange={handleSpringChange}
            />
          </TabsContent>
        </Tabs>
      </PopoverContent>
    </Popover>
  );
});

/**
 * Preset category section with grid of presets.
 */
const PresetCategory = memo(function PresetCategory({
  category,
  selectedPreset,
  onSelect,
}: {
  category: { id: EasingCategory; name: string; description: string };
  selectedPreset: EasingPreset | undefined;
  onSelect: (preset: EasingPreset) => void;
}) {
  const presets = useMemo(
    () => getPresetsByCategory(category.id),
    [category.id]
  );

  if (presets.length === 0) return null;

  return (
    <div>
      <div className="mb-2">
        <h4 className="text-xs font-medium">{category.name}</h4>
        <p className="text-xs text-muted-foreground">{category.description}</p>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {presets.map((preset) => (
          <PresetButton
            key={preset.id}
            preset={preset}
            isSelected={selectedPreset?.id === preset.id}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
});

/**
 * Single preset button with thumbnail and name.
 */
const PresetButton = memo(function PresetButton({
  preset,
  isSelected,
  onSelect,
}: {
  preset: EasingPreset;
  isSelected: boolean;
  onSelect: (preset: EasingPreset) => void;
}) {
  return (
    <button
      onClick={() => onSelect(preset)}
      className={cn(
        'relative flex flex-col items-center gap-1 p-2 rounded-md border transition-colors',
        'hover:bg-accent hover:border-accent-foreground/20',
        isSelected && 'bg-accent border-primary'
      )}
    >
      <EasingThumbnail config={preset.config} svgPath={preset.svgPath} size={32} />
      <span className="text-[10px] text-center leading-tight truncate w-full">
        {preset.name}
      </span>
      {isSelected && (
        <div className="absolute top-1 right-1">
          <Check className="w-3 h-3 text-primary" />
        </div>
      )}
    </button>
  );
});

/**
 * Easing curve thumbnail renderer.
 * Renders SVG path or generates preview for custom configs.
 */
const EasingThumbnail = memo(function EasingThumbnail({
  config,
  svgPath,
  size = 24,
}: {
  config: EasingConfig;
  svgPath?: string;
  size?: number;
}) {
  // If we have a pre-defined SVG path, use it
  if (svgPath) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        className="shrink-0"
      >
        <rect
          x="2"
          y="4"
          width="20"
          height="16"
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.1"
          strokeWidth="0.5"
        />
        <path
          d={svgPath}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  // Generate preview for custom configs
  if (config.type === 'cubic-bezier' && config.bezier) {
    return (
      <BezierCurvePreview
        value={config.bezier}
        width={size}
        height={size}
      />
    );
  }

  if (config.type === 'spring' && config.spring) {
    return (
      <SpringCurvePreview
        value={config.spring}
        width={size}
        height={size}
      />
    );
  }

  // Fallback to basic curve from EASING_CURVES
  const basicCurves: Record<string, string> = {
    linear: 'M2,20 L22,4',
    'ease-in': 'M2,20 Q2,4 22,4',
    'ease-out': 'M2,20 Q22,20 22,4',
    'ease-in-out': 'M2,20 C2,12 22,12 22,4',
  };

  const path = basicCurves[config.type] || basicCurves.linear;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className="shrink-0"
    >
      <rect
        x="2"
        y="4"
        width="20"
        height="16"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.1"
        strokeWidth="0.5"
      />
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
});

/**
 * Compact easing picker for inline use (smaller trigger).
 */
export const CompactAdvancedEasingPicker = memo(function CompactAdvancedEasingPicker({
  value,
  easingConfig,
  onChange,
  disabled = false,
}: Omit<AdvancedEasingPickerProps, 'className'>) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<string>('presets');

  const currentConfig = useMemo((): EasingConfig => {
    if (easingConfig) return easingConfig;
    return { type: value };
  }, [value, easingConfig]);

  const matchingPreset = useMemo(
    () => findMatchingPreset(currentConfig),
    [currentConfig]
  );

  const handlePresetSelect = useCallback(
    (preset: EasingPreset) => {
      onChange(preset.config.type, preset.config);
      setOpen(false);
    },
    [onChange]
  );

  const handleBezierChange = useCallback(
    (bezier: BezierControlPoints) => {
      onChange('cubic-bezier', { type: 'cubic-bezier', bezier });
    },
    [onChange]
  );

  const handleSpringChange = useCallback(
    (spring: SpringParameters) => {
      onChange('spring', { type: 'spring', spring });
    },
    [onChange]
  );

  const currentBezier = useMemo((): BezierControlPoints => {
    if (currentConfig.type === 'cubic-bezier' && currentConfig.bezier) {
      return currentConfig.bezier;
    }
    return DEFAULT_BEZIER_POINTS;
  }, [currentConfig]);

  const currentSpring = useMemo((): SpringParameters => {
    if (currentConfig.type === 'spring' && currentConfig.spring) {
      return currentConfig.spring;
    }
    return DEFAULT_SPRING_PARAMS;
  }, [currentConfig]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          className="w-9 h-7 p-0"
        >
          <EasingThumbnail config={currentConfig} size={20} />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="w-full grid grid-cols-3 rounded-none border-b">
            <TabsTrigger value="presets" className="text-xs">
              Presets
            </TabsTrigger>
            <TabsTrigger value="bezier" className="text-xs">
              Custom
            </TabsTrigger>
            <TabsTrigger value="spring" className="text-xs">
              Spring
            </TabsTrigger>
          </TabsList>

          <TabsContent value="presets" className="m-0">
            <ScrollArea className="h-[300px]">
              <div className="p-2 space-y-4">
                {EASING_CATEGORIES.map((category) => (
                  <PresetCategory
                    key={category.id}
                    category={category}
                    selectedPreset={matchingPreset}
                    onSelect={handlePresetSelect}
                  />
                ))}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="bezier" className="m-0 p-4">
            <BezierCurveEditor
              value={currentBezier}
              onChange={handleBezierChange}
              width={248}
              height={200}
            />
          </TabsContent>

          <TabsContent value="spring" className="m-0 p-4">
            <SpringEditor
              value={currentSpring}
              onChange={handleSpringChange}
            />
          </TabsContent>
        </Tabs>
      </PopoverContent>
    </Popover>
  );
});
