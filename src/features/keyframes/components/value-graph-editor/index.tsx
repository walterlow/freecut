/**
 * Value Graph Editor - Main container component.
 * Interactive graph for editing keyframe values and timing.
 */

import { memo, useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { ZoomIn, ZoomOut, Maximize2, RotateCcw, ChevronLeft, ChevronRight, Plus, Trash2, Magnet } from 'lucide-react';
import { cn } from '@/shared/ui/cn';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { Keyframe, AnimatableProperty, KeyframeRef, BezierControlPoints } from '@/types/keyframe';
import { PROPERTY_LABELS } from '@/types/keyframe';
import type { GraphViewport, GraphKeyframePoint } from './types';
import { DEFAULT_GRAPH_PADDING, PROPERTY_VALUE_RANGES } from './types';
import { GraphGrid } from './graph-grid';
import { GraphKeyframes } from './graph-keyframe';
import { GraphCurves, GraphExtensionLines, GraphPlayhead } from './graph-curve';
import { GraphHandles } from './graph-handles';
import { GraphTransitionRegions } from './graph-transition-regions';
import { useGraphInteraction } from './use-graph-interaction';
import type { BlockedFrameRange } from '../../utils/transition-region';

interface ValueGraphEditorProps {
  /** Item ID to show keyframes for */
  itemId: string;
  /** Keyframes organized by property */
  keyframesByProperty: Partial<Record<AnimatableProperty, Keyframe[]>>;
  /** Currently selected property (or null to show all) */
  selectedProperty?: AnimatableProperty | null;
  /** Selected keyframe IDs */
  selectedKeyframeIds?: Set<string>;
  /** Current playhead frame */
  currentFrame?: number;
  /** Total duration in frames */
  totalFrames?: number;
  /** Width of the editor */
  width?: number;
  /** Height of the editor */
  height?: number;
  /** Callback when keyframe is moved */
  onKeyframeMove?: (ref: KeyframeRef, newFrame: number, newValue: number) => void;
  /** Callback when bezier handles are moved */
  onBezierHandleMove?: (ref: KeyframeRef, bezier: BezierControlPoints) => void;
  /** Callback when selection changes */
  onSelectionChange?: (keyframeIds: Set<string>) => void;
  /** Callback when property selection changes */
  onPropertyChange?: (property: AnimatableProperty | null) => void;
  /** Callback when playhead is scrubbed (frame is clip-relative) */
  onScrub?: (frame: number) => void;
  /** Callback when drag starts (for undo batching) */
  onDragStart?: () => void;
  /** Callback when drag ends (for undo batching) */
  onDragEnd?: () => void;
  /** Callback to add a keyframe at the current frame */
  onAddKeyframe?: (property: AnimatableProperty, frame: number) => void;
  /** Callback to remove selected keyframes */
  onRemoveKeyframes?: (refs: KeyframeRef[]) => void;
  /** Callback to navigate to a keyframe (sets playhead to that frame) */
  onNavigateToKeyframe?: (frame: number) => void;
  /** Transition-blocked frame ranges (keyframes cannot be placed here) */
  transitionBlockedRanges?: BlockedFrameRange[];
  /** Whether the editor is disabled */
  disabled?: boolean;
  /** Additional class name */
  className?: string;
}

/**
 * Full-featured value graph editor for keyframe animation.
 * Shows keyframes as draggable points with interpolation curves.
 */
export const ValueGraphEditor = memo(function ValueGraphEditor({
  itemId,
  keyframesByProperty,
  selectedProperty = null,
  selectedKeyframeIds = new Set(),
  currentFrame = 0,
  totalFrames = 300,
  width = 600,
  height = 300,
  onKeyframeMove,
  onBezierHandleMove,
  onSelectionChange,
  onPropertyChange,
  onScrub,
  onDragStart,
  onDragEnd,
  onAddKeyframe,
  onRemoveKeyframes,
  onNavigateToKeyframe,
  transitionBlockedRanges = [],
  disabled = false,
  className,
}: ValueGraphEditorProps) {
  const padding = DEFAULT_GRAPH_PADDING;
  const svgRef = useRef<SVGSVGElement>(null);
  
  // Track if playhead is being scrubbed (to prevent background click deselection)
  const isScrrubbingRef = useRef(false);
  
  // Calculate heights for layout
  // Toolbar: ~28px (min-h-7), gaps: ~4px (gap-1)
  const toolbarHeight = 28;
  const gaps = 4; // gap-1 = 4px
  const totalFixedHeight = toolbarHeight + gaps;
  const graphHeight = Math.max(60, height - totalFixedHeight);

  // Get available properties
  const availableProperties = useMemo(
    () => Object.keys(keyframesByProperty) as AnimatableProperty[],
    [keyframesByProperty]
  );

  // Determine which property to show
  const displayProperty = selectedProperty || availableProperties[0] || null;

  // Get keyframes for the selected property
  const keyframes = useMemo(
    () => (displayProperty ? keyframesByProperty[displayProperty] || [] : []),
    [displayProperty, keyframesByProperty]
  );

  // Get property value range for fixed viewport bounds
  const propertyRange = displayProperty ? PROPERTY_VALUE_RANGES[displayProperty] : null;

  // Calculate viewport with fixed bounds based on property range and clip duration
  const calculateFittedViewport = useCallback((): GraphViewport => {
    return {
      width,
      height: graphHeight,
      startFrame: 0,
      endFrame: Math.max(totalFrames, 60),
      minValue: propertyRange?.min ?? 0,
      maxValue: propertyRange?.max ?? 1,
    };
  }, [totalFrames, width, graphHeight, propertyRange]);

  const [viewport, setViewport] = useState<GraphViewport>(() => calculateFittedViewport());
  
  // Snapping state
  const [snapEnabled, setSnapEnabled] = useState(true);

  // Update viewport when keyframes or property changes
  useEffect(() => {
    setViewport(calculateFittedViewport());
  }, [calculateFittedViewport, displayProperty]);

  // Convert keyframes to graph points
  const points = useMemo((): GraphKeyframePoint[] => {
    if (!displayProperty) return [];

    const graphLeft = padding.left;
    const graphTop = padding.top;
    const graphWidth = viewport.width - padding.left - padding.right;
    const graphHeight = viewport.height - padding.top - padding.bottom;
    const frameRange = viewport.endFrame - viewport.startFrame;
    const valueRange = viewport.maxValue - viewport.minValue;

    return keyframes.map((keyframe) => ({
      keyframe,
      itemId,
      property: displayProperty,
      x: graphLeft + ((keyframe.frame - viewport.startFrame) / frameRange) * graphWidth,
      y: graphTop + (1 - (keyframe.value - viewport.minValue) / valueRange) * graphHeight,
      isSelected: selectedKeyframeIds.has(keyframe.id),
      isDragging: false,
    }));
  }, [displayProperty, keyframes, itemId, viewport, padding, selectedKeyframeIds]);

  // Calculate snap targets for keyframe dragging
  const snapTargets = useMemo(() => {
    // Frame targets: other keyframe frames, playhead position
    const frameTargets: number[] = [];
    // Value targets: 0, min, max, and other keyframe values
    const valueTargets: number[] = [];

    // Add special frame targets
    frameTargets.push(0); // Start of clip
    frameTargets.push(currentFrame); // Playhead position

    // Add special value targets based on property range
    if (propertyRange) {
      valueTargets.push(propertyRange.min);
      valueTargets.push(propertyRange.max);
      // Add 0 if it's within range
      if (propertyRange.min <= 0 && propertyRange.max >= 0) {
        valueTargets.push(0);
      }
      // Add 1 for normalized properties (opacity, scale)
      if (propertyRange.min <= 1 && propertyRange.max >= 1) {
        valueTargets.push(1);
      }
    }

    // Add other keyframes' positions (excluding currently selected ones)
    for (const kf of keyframes) {
      if (!selectedKeyframeIds.has(kf.id)) {
        frameTargets.push(kf.frame);
        valueTargets.push(kf.value);
      }
    }

    // Remove duplicates
    return {
      frameTargets: [...new Set(frameTargets)],
      valueTargets: [...new Set(valueTargets)],
    };
  }, [keyframes, selectedKeyframeIds, currentFrame, propertyRange]);

  // Interaction handlers
  const {
    dragState,
    isDragging,
    previewValues,
    draggingHandle,
    constraintAxis,
    handleKeyframePointerDown,
    handleKeyframeClick,
    handleBezierPointerDown,
    handlePointerMove,
    handlePointerUp,
    handleWheel,
    handleBackgroundClick,
    zoomIn,
    zoomOut,
    fitToContent,
  } = useGraphInteraction({
    viewport,
    padding,
    points,
    selectedKeyframeIds,
    maxFrame: totalFrames,
    minValue: displayProperty ? PROPERTY_VALUE_RANGES[displayProperty]?.min : undefined,
    maxValue: displayProperty ? PROPERTY_VALUE_RANGES[displayProperty]?.max : undefined,
    onViewportChange: setViewport,
    onSelectionChange,
    onKeyframeMove,
    onBezierHandleMove,
    onDragStart,
    onDragEnd,
    snapEnabled,
    snapFrameTargets: snapTargets.frameTargets,
    snapValueTargets: snapTargets.valueTargets,
    blockedFrameRanges: transitionBlockedRanges,
    disabled,
  });

  // Update points with drag state and preview positions
  const pointsWithDragState = useMemo(() => {
    // If we're dragging and have preview values, update the dragged point's position
    if (isDragging && dragState?.type === 'keyframe' && previewValues) {
      const graphLeft = padding.left;
      const graphTop = padding.top;
      const graphWidth = viewport.width - padding.left - padding.right;
      const graphHeight = viewport.height - padding.top - padding.bottom;
      const frameRange = viewport.endFrame - viewport.startFrame;
      const valueRange = viewport.maxValue - viewport.minValue;

      return points.map((point) => {
        const isThisDragging = dragState.keyframeId === point.keyframe.id;
        if (isThisDragging) {
          // Calculate new screen position from preview values
          const newX = graphLeft + ((previewValues.frame - viewport.startFrame) / frameRange) * graphWidth;
          const newY = graphTop + (1 - (previewValues.value - viewport.minValue) / valueRange) * graphHeight;
          return {
            ...point,
            x: newX,
            y: newY,
            isDragging: true,
          };
        }
        return {
          ...point,
          isDragging: false,
        };
      });
    }

    // Not dragging - just update isDragging flag
    return points.map((point) => ({
      ...point,
      isDragging: dragState?.keyframeId === point.keyframe.id,
    }));
  }, [points, dragState, isDragging, previewValues, viewport, padding]);

  // Reset viewport (fit to content)
  const resetViewport = useCallback(() => {
    setViewport(calculateFittedViewport());
  }, [calculateFittedViewport]);

  // Handle property change
  const handlePropertySelect = useCallback(
    (value: string) => {
      const newProperty = value === 'all' ? null : (value as AnimatableProperty);
      onPropertyChange?.(newProperty);
    },
    [onPropertyChange]
  );

  // Get sorted keyframe frames for navigation
  const sortedKeyframeFrames = useMemo(() => {
    return keyframes.map(kf => kf.frame).toSorted((a, b) => a - b);
  }, [keyframes]);

  // Find previous keyframe frame
  const prevKeyframeFrame = useMemo(() => {
    for (let i = sortedKeyframeFrames.length - 1; i >= 0; i--) {
      if (sortedKeyframeFrames[i]! < currentFrame) {
        return sortedKeyframeFrames[i];
      }
    }
    return null;
  }, [sortedKeyframeFrames, currentFrame]);

  // Find next keyframe frame
  const nextKeyframeFrame = useMemo(() => {
    for (const frame of sortedKeyframeFrames) {
      if (frame > currentFrame) {
        return frame;
      }
    }
    return null;
  }, [sortedKeyframeFrames, currentFrame]);

  // Check if there's a keyframe at the current frame
  const hasKeyframeAtCurrentFrame = useMemo(() => {
    return keyframes.some(kf => kf.frame === currentFrame);
  }, [keyframes, currentFrame]);

  // Get selected keyframe (only when exactly one is selected)
  const selectedKeyframe = useMemo(() => {
    if (selectedKeyframeIds.size !== 1) return null;
    const selectedId = [...selectedKeyframeIds][0];
    return keyframes.find(kf => kf.id === selectedId) ?? null;
  }, [selectedKeyframeIds, keyframes]);

  // Local state for input fields (commit on Enter/blur)
  const [frameInputValue, setFrameInputValue] = useState<string>('');
  const [valueInputValue, setValueInputValue] = useState<string>('');

  // Get decimal places for current property
  const valueDecimals = propertyRange?.decimals ?? 2;

  // Format value based on property's decimal setting
  const formatValue = useCallback((value: number) => {
    return valueDecimals === 0 ? String(Math.round(value)) : value.toFixed(valueDecimals);
  }, [valueDecimals]);

  // Sync local input state when selected keyframe changes
  useEffect(() => {
    if (selectedKeyframe) {
      setFrameInputValue(String(selectedKeyframe.frame));
      setValueInputValue(formatValue(selectedKeyframe.value));
    }
  }, [selectedKeyframe?.id, selectedKeyframe?.frame, selectedKeyframe?.value, formatValue]);

  // Commit frame value
  const commitFrameValue = useCallback(() => {
    if (!selectedKeyframe || !displayProperty || !onKeyframeMove) return;
    
    const newFrame = Math.round(Number(frameInputValue));
    if (isNaN(newFrame)) {
      // Reset to current value if invalid
      setFrameInputValue(String(selectedKeyframe.frame));
      return;
    }
    
    // Clamp to valid range
    const clampedFrame = Math.max(0, Math.min(totalFrames - 1, newFrame));
    
    // Skip if no change
    if (clampedFrame === selectedKeyframe.frame) {
      setFrameInputValue(String(selectedKeyframe.frame));
      return;
    }
    
    // Wrap in undo batch
    onDragStart?.();
    onKeyframeMove(
      { itemId, property: displayProperty, keyframeId: selectedKeyframe.id },
      clampedFrame,
      selectedKeyframe.value
    );
    onDragEnd?.();
    
    // Move playhead to the new frame
    onNavigateToKeyframe?.(clampedFrame);
  }, [selectedKeyframe, displayProperty, itemId, totalFrames, frameInputValue, onKeyframeMove, onDragStart, onDragEnd, onNavigateToKeyframe]);

  // Commit value
  const commitValueInput = useCallback(() => {
    if (!selectedKeyframe || !displayProperty || !onKeyframeMove) return;
    
    const newValue = Number(valueInputValue);
    if (isNaN(newValue)) {
      // Reset to current value if invalid
      setValueInputValue(formatValue(selectedKeyframe.value));
      return;
    }
    
    // Clamp to property range
    const range = PROPERTY_VALUE_RANGES[displayProperty];
    const clampedValue = range 
      ? Math.max(range.min, Math.min(range.max, newValue))
      : newValue;
    
    // Skip if no change (with small epsilon for floating point)
    if (Math.abs(clampedValue - selectedKeyframe.value) < 0.0001) {
      setValueInputValue(formatValue(selectedKeyframe.value));
      return;
    }
    
    // Wrap in undo batch
    onDragStart?.();
    onKeyframeMove(
      { itemId, property: displayProperty, keyframeId: selectedKeyframe.id },
      selectedKeyframe.frame,
      clampedValue
    );
    onDragEnd?.();
  }, [selectedKeyframe, displayProperty, itemId, valueInputValue, onKeyframeMove, onDragStart, onDragEnd, formatValue]);

  // Handle key down for Enter to commit
  const handleInputKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>, commitFn: () => void) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur();
      commitFn();
    } else if (e.key === 'Escape') {
      // Reset on escape
      if (selectedKeyframe) {
        setFrameInputValue(String(selectedKeyframe.frame));
        setValueInputValue(formatValue(selectedKeyframe.value));
      }
      e.currentTarget.blur();
    }
  }, [selectedKeyframe, formatValue]);

  // Navigate to previous keyframe and select it
  const goToPrevKeyframe = useCallback(() => {
    if (prevKeyframeFrame !== null && prevKeyframeFrame !== undefined && onNavigateToKeyframe) {
      onNavigateToKeyframe(prevKeyframeFrame);
      // Select the keyframe at that frame
      const keyframeAtFrame = keyframes.find(kf => kf.frame === prevKeyframeFrame);
      if (keyframeAtFrame && onSelectionChange) {
        onSelectionChange(new Set([keyframeAtFrame.id]));
      }
    }
  }, [prevKeyframeFrame, onNavigateToKeyframe, keyframes, onSelectionChange]);

  // Navigate to next keyframe and select it
  const goToNextKeyframe = useCallback(() => {
    if (nextKeyframeFrame !== null && onNavigateToKeyframe) {
      onNavigateToKeyframe(nextKeyframeFrame);
      // Select the keyframe at that frame
      const keyframeAtFrame = keyframes.find(kf => kf.frame === nextKeyframeFrame);
      if (keyframeAtFrame && onSelectionChange) {
        onSelectionChange(new Set([keyframeAtFrame.id]));
      }
    }
  }, [nextKeyframeFrame, onNavigateToKeyframe, keyframes, onSelectionChange]);

  // Add keyframe at current frame
  const handleAddKeyframe = useCallback(() => {
    if (displayProperty && onAddKeyframe) {
      onAddKeyframe(displayProperty, currentFrame);
    }
  }, [displayProperty, currentFrame, onAddKeyframe]);

  // Remove selected keyframes
  const handleRemoveKeyframes = useCallback(() => {
    if (!displayProperty || !onRemoveKeyframes) return;
    
    const refs: KeyframeRef[] = [];
    for (const kfId of selectedKeyframeIds) {
      refs.push({
        itemId,
        property: displayProperty,
        keyframeId: kfId,
      });
    }
    
    if (refs.length > 0) {
      onRemoveKeyframes(refs);
    }
  }, [displayProperty, selectedKeyframeIds, itemId, onRemoveKeyframes]);

  // Wrapped scrub handler that tracks scrubbing state
  const handlePlayheadScrubStart = useCallback(() => {
    isScrrubbingRef.current = true;
  }, []);

  const handlePlayheadScrubEnd = useCallback(() => {
    // Delay clearing the flag to prevent click event from deselecting
    setTimeout(() => {
      isScrrubbingRef.current = false;
    }, 100);
  }, []);

  // Custom background click that respects scrubbing state
  const handleGraphBackgroundClick = useCallback(
    (event: React.MouseEvent) => {
      // Don't deselect if we just finished scrubbing
      if (isScrrubbingRef.current) return;
      handleBackgroundClick(event);
    },
    [handleBackgroundClick]
  );

  // Attach native wheel event listener with passive: false to prevent page scroll
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const handleNativeWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };

    svg.addEventListener('wheel', handleNativeWheel, { passive: false });
    return () => {
      svg.removeEventListener('wheel', handleNativeWheel);
    };
  }, []);

  return (
    <div className={cn('flex flex-col gap-1 h-full overflow-hidden', className)} style={{ height }}>
      {/* Toolbar */}
      <div className="flex items-center justify-between px-2 flex-shrink-0 min-h-7">
        <div className="flex items-center gap-2">
          {/* Property selector */}
          <Select
            value={displayProperty || 'all'}
            onValueChange={handlePropertySelect}
            disabled={disabled || availableProperties.length === 0}
          >
            <SelectTrigger className="w-[140px] h-7 text-xs focus:ring-0 focus:ring-offset-0">
              <SelectValue placeholder="Select property" />
            </SelectTrigger>
            <SelectContent>
              {availableProperties.map((prop) => (
                <SelectItem key={prop} value={prop} className="text-xs">
                  {PROPERTY_LABELS[prop]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Keyframe count */}
          <span className="text-xs text-muted-foreground">
            {keyframes.length} keyframe{keyframes.length !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Keyframe controls */}
        <div className="flex items-center gap-1">
          {/* Navigation */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={goToPrevKeyframe}
                disabled={disabled || prevKeyframeFrame === null || !onNavigateToKeyframe}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Previous keyframe</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={goToNextKeyframe}
                disabled={disabled || nextKeyframeFrame === null || !onNavigateToKeyframe}
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Next keyframe</TooltipContent>
          </Tooltip>

          {/* Separator */}
          <div className="w-px h-4 bg-border mx-1" />

          {/* Add/Remove */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={hasKeyframeAtCurrentFrame ? "secondary" : "ghost"}
                size="sm"
                className="h-7 w-7 p-0"
                onClick={handleAddKeyframe}
                disabled={disabled || !displayProperty || !onAddKeyframe || hasKeyframeAtCurrentFrame}
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {hasKeyframeAtCurrentFrame ? 'Keyframe exists at current frame' : 'Add keyframe at current frame'}
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                onClick={handleRemoveKeyframes}
                disabled={disabled || selectedKeyframeIds.size === 0 || !onRemoveKeyframes}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {selectedKeyframeIds.size > 0 
                ? `Remove ${selectedKeyframeIds.size} selected keyframe${selectedKeyframeIds.size !== 1 ? 's' : ''}`
                : 'Remove selected keyframes'}
            </TooltipContent>
          </Tooltip>

          {/* Separator */}
          <div className="w-px h-4 bg-border mx-1" />

          {/* Snapping toggle */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  "h-7 w-7 p-0",
                  snapEnabled && "bg-primary text-primary-foreground hover:bg-primary/90"
                )}
                onClick={() => setSnapEnabled(!snapEnabled)}
                disabled={disabled}
              >
                <Magnet className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {snapEnabled ? 'Snapping enabled (hold Ctrl to disable temporarily)' : 'Enable snapping'}
            </TooltipContent>
          </Tooltip>

          {/* Separator */}
          <div className="w-px h-4 bg-border mx-1" />

          {/* Precise value inputs (always reserve space to prevent layout shift) */}
          <div className="flex items-center gap-0.5">
            <span className="text-[10px] text-muted-foreground">F:</span>
            <Input
              type="number"
              value={selectedKeyframe ? frameInputValue : ''}
              onChange={(e) => setFrameInputValue(e.target.value)}
              onBlur={commitFrameValue}
              onKeyDown={(e) => handleInputKeyDown(e, commitFrameValue)}
              placeholder="-"
              className="w-12 h-5 text-[10px] px-1 text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              min={0}
              max={totalFrames - 1}
              disabled={disabled || !onKeyframeMove || !selectedKeyframe}
            />
          </div>
          <div className="flex items-center gap-0.5">
            <span className="text-[10px] text-muted-foreground">V:</span>
            <Input
              type="number"
              value={selectedKeyframe ? valueInputValue : ''}
              onChange={(e) => setValueInputValue(e.target.value)}
              onBlur={commitValueInput}
              onKeyDown={(e) => handleInputKeyDown(e, commitValueInput)}
              step={0.01}
              placeholder="-"
              className="w-14 h-5 text-[10px] px-1 text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              min={propertyRange?.min}
              max={propertyRange?.max}
              disabled={disabled || !onKeyframeMove || !selectedKeyframe}
            />
          </div>
          <div className="w-px h-4 bg-border mx-1" />
        </div>

        {/* Zoom controls */}
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={zoomOut}
                disabled={disabled}
              >
                <ZoomOut className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Zoom out</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={zoomIn}
                disabled={disabled}
              >
                <ZoomIn className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Zoom in</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={fitToContent}
                disabled={disabled || keyframes.length === 0}
              >
                <Maximize2 className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Fit to content</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={resetViewport}
                disabled={disabled}
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Reset view</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Graph */}
      <svg
        ref={svgRef}
        width={width}
        height={graphHeight}
        className={cn(
          'border border-border rounded-md flex-shrink-0',
          disabled && 'opacity-50 pointer-events-none'
        )}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onWheel={handleWheel}
        onClick={handleGraphBackgroundClick}
        style={{ 
          touchAction: 'none',
          cursor: isDragging && dragState?.type === 'keyframe' ? 'pointer' : undefined,
        }}
      >
        {/* Grid background */}
        <GraphGrid viewport={viewport} padding={padding} />

        {/* Transition blocked regions (rendered before curves/keyframes) */}
        {transitionBlockedRanges.length > 0 && (
          <GraphTransitionRegions
            viewport={viewport}
            padding={padding}
            blockedRanges={transitionBlockedRanges}
          />
        )}

        {/* Extension lines (before/after keyframes) */}
        <GraphExtensionLines points={pointsWithDragState} viewport={viewport} padding={padding} />

        {/* Interpolation curves */}
        <GraphCurves points={pointsWithDragState} selectedKeyframeIds={selectedKeyframeIds} />

        {/* Playhead (rendered before keyframes so keyframes get click priority) */}
        <GraphPlayhead 
          frame={currentFrame} 
          viewport={viewport} 
          padding={padding}
          totalFrames={totalFrames}
          onScrub={onScrub}
          onScrubStart={handlePlayheadScrubStart}
          onScrubEnd={handlePlayheadScrubEnd}
          disabled={disabled}
        />

        {/* Bezier handles (for selected keyframes with cubic-bezier easing) */}
        <GraphHandles
          points={pointsWithDragState}
          selectedKeyframeIds={selectedKeyframeIds}
          onHandlePointerDown={handleBezierPointerDown}
          draggingHandle={draggingHandle}
          disabled={disabled}
        />

        {/* Keyframe points (rendered last for highest click priority) */}
        <GraphKeyframes
          points={pointsWithDragState}
          previewValues={previewValues}
          onPointerDown={handleKeyframePointerDown}
          onClick={handleKeyframeClick}
          disabled={disabled}
        />

        {/* Constraint guide line when Shift is held during drag */}
        {isDragging && constraintAxis && dragState?.type === 'keyframe' && (() => {
          const draggingPoint = pointsWithDragState.find(p => p.keyframe.id === dragState.keyframeId);
          if (!draggingPoint) return null;
          
          const graphLeft = padding.left;
          const graphRight = viewport.width - padding.right;
          const graphTop = padding.top;
          const graphBottom = viewport.height - padding.bottom;
          
          return constraintAxis === 'x' ? (
            // Horizontal constraint line (frame only movement)
            <line
              x1={graphLeft}
              y1={draggingPoint.y}
              x2={graphRight}
              y2={draggingPoint.y}
              stroke="#f97316"
              strokeWidth={1.5}
              strokeDasharray="6 3"
              opacity={0.8}
              pointerEvents="none"
            />
          ) : (
            // Vertical constraint line (value only movement)
            <line
              x1={draggingPoint.x}
              y1={graphTop}
              x2={draggingPoint.x}
              y2={graphBottom}
              stroke="#f97316"
              strokeWidth={1.5}
              strokeDasharray="6 3"
              opacity={0.8}
              pointerEvents="none"
            />
          );
        })()}
      </svg>

      {/* Keyboard hints (shows when dragging) */}
      {isDragging && dragState?.type === 'keyframe' && (
        <div className="text-xs text-muted-foreground text-center space-x-3">
          <span><kbd className="px-1 py-0.5 bg-muted rounded text-[10px]">Shift</kbd> constrain axis</span>
          <span><kbd className="px-1 py-0.5 bg-muted rounded text-[10px]">Alt</kbd> fine adjust</span>
        </div>
      )}
    </div>
  );
});

