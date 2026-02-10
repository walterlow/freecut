import { useCallback, useRef, useEffect, memo, Activity } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Film,
  Layers,
  Type,
  Square,
  Circle,
  Triangle,
  Star,
  Hexagon,
  Heart,
  Pentagon,
  Sun,
  Contrast,
  Droplets,
  Wind,
  Palette,
  CircleDot,
  ImageOff,
  Sparkles,
  Zap,
  Scan,
  Wand2,
  Grid3X3,
  Blend,
} from 'lucide-react';
import { useEditorStore } from '../stores/editor-store';
import { useTimelineStore } from '@/features/timeline/stores/timeline-store';
import { usePlaybackStore } from '@/features/preview/stores/playback-store';
import { useSelectionStore } from '../stores/selection-store';
import { useProjectStore } from '@/features/projects/stores/project-store';
import { MediaLibrary } from '@/features/media-library/components/media-library';
import { TransitionsPanel } from './transitions-panel';
import { findNearestAvailableSpace } from '@/features/timeline/utils/collision-utils';
import type { TextItem, ShapeItem, ShapeType, AdjustmentItem } from '@/types/timeline';
import type { VisualEffect, CSSFilterType, GlitchVariant } from '@/types/effects';
import {
  CSS_FILTER_CONFIGS,
  GLITCH_CONFIGS,
  EFFECT_PRESETS,
  HALFTONE_CONFIG,
  VIGNETTE_CONFIG,
} from '@/types/effects';

export const MediaSidebar = memo(function MediaSidebar() {
  // Use granular selectors - Zustand v5 best practice
  const leftSidebarOpen = useEditorStore((s) => s.leftSidebarOpen);
  const toggleLeftSidebar = useEditorStore((s) => s.toggleLeftSidebar);
  const activeTab = useEditorStore((s) => s.activeTab);
  const setActiveTab = useEditorStore((s) => s.setActiveTab);
  const sidebarWidth = useEditorStore((s) => s.sidebarWidth);
  const setSidebarWidth = useEditorStore((s) => s.setSidebarWidth);

  // Resize handle logic
  const isResizingRef = useRef(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizingRef.current = true;
    startXRef.current = e.clientX;
    startWidthRef.current = sidebarWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [sidebarWidth]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingRef.current) return;
      const delta = e.clientX - startXRef.current;
      const newWidth = Math.min(500, Math.max(320, startWidthRef.current + delta));
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      if (!isResizingRef.current) return;
      isResizingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      isResizingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [setSidebarWidth]);

  // NOTE: Don't subscribe to tracks, items, currentProject here!
  // These change frequently and would cause re-renders cascading to MediaLibrary/MediaCards
  // Read from store directly in callbacks using getState()

  // Add text item to timeline at the best available position
  const handleAddText = useCallback(() => {
    // Read all needed state from stores directly to avoid subscriptions
    const { tracks, items, fps, addItem } = useTimelineStore.getState();
    const { activeTrackId, selectItems } = useSelectionStore.getState();
    const currentProject = useProjectStore.getState().currentProject;

    // Use active track if available and not locked, otherwise find first available
    let targetTrack = activeTrackId
      ? tracks.find((t) => t.id === activeTrackId && t.visible !== false && !t.locked)
      : null;

    // Fallback to first available visible/unlocked track
    if (!targetTrack) {
      targetTrack = tracks.find((t) => t.visible !== false && !t.locked);
    }

    if (!targetTrack) {
      console.warn('No available track for text item');
      return;
    }

    // Default duration: 60 seconds
    const durationInFrames = fps * 60;

    // Find the best position: start at playhead, find nearest available space
    const proposedPosition = usePlaybackStore.getState().currentFrame;
    const finalPosition = findNearestAvailableSpace(
      proposedPosition,
      durationInFrames,
      targetTrack.id,
      items
    ) ?? proposedPosition; // Fallback to proposed if no space found

    // Get canvas dimensions for initial transform
    const canvasWidth = currentProject?.metadata.width ?? 1920;
    const canvasHeight = currentProject?.metadata.height ?? 1080;

    // Create a new text item
    const textItem: TextItem = {
      id: crypto.randomUUID(),
      type: 'text',
      trackId: targetTrack.id,
      from: finalPosition,
      durationInFrames,
      label: 'Text',
      text: 'Your Text Here',
      fontSize: 60,
      fontFamily: 'Inter',
      fontWeight: 'normal',
      color: '#ffffff',
      textAlign: 'center',
      lineHeight: 1.2,
      letterSpacing: 0,
      // Center the text on canvas
      transform: {
        x: 0,
        y: 0,
        width: canvasWidth * 0.8,
        height: canvasHeight * 0.3,
        rotation: 0,
        opacity: 1,
      },
    };

    addItem(textItem);
    // Select the new item
    selectItems([textItem.id]);
  }, []);

  // Add shape item to timeline at the best available position
  const handleAddShape = useCallback((shapeType: ShapeType) => {
    // Read all needed state from stores directly to avoid subscriptions
    const { tracks, items, fps, addItem } = useTimelineStore.getState();
    const { activeTrackId, selectItems } = useSelectionStore.getState();
    const currentProject = useProjectStore.getState().currentProject;

    // Use active track if available and not locked, otherwise find first available
    let targetTrack = activeTrackId
      ? tracks.find((t) => t.id === activeTrackId && t.visible !== false && !t.locked)
      : null;

    // Fallback to first available visible/unlocked track
    if (!targetTrack) {
      targetTrack = tracks.find((t) => t.visible !== false && !t.locked);
    }

    if (!targetTrack) {
      console.warn('No available track for shape item');
      return;
    }

    // Default duration: 60 seconds
    const durationInFrames = fps * 60;

    // Find the best position: start at playhead, find nearest available space
    const proposedPosition = usePlaybackStore.getState().currentFrame;
    const finalPosition = findNearestAvailableSpace(
      proposedPosition,
      durationInFrames,
      targetTrack.id,
      items
    ) ?? proposedPosition;

    // Get canvas dimensions for initial transform
    const canvasWidth = currentProject?.metadata.width ?? 1920;
    const canvasHeight = currentProject?.metadata.height ?? 1080;

    // Shape size: 25% of canvas, centered
    const shapeSize = Math.min(canvasWidth, canvasHeight) * 0.25;

    // Create a new shape item with defaults based on shape type
    const shapeItem: ShapeItem = {
      id: crypto.randomUUID(),
      type: 'shape',
      trackId: targetTrack.id,
      from: finalPosition,
      durationInFrames,
      label: shapeType.charAt(0).toUpperCase() + shapeType.slice(1),
      shapeType,
      fillColor: '#3b82f6', // Blue
      strokeColor: undefined,
      strokeWidth: 0,
      cornerRadius: shapeType === 'rectangle' ? 0 : undefined,
      direction: shapeType === 'triangle' ? 'up' : undefined,
      points: shapeType === 'star' ? 5 : shapeType === 'polygon' ? 6 : undefined,
      innerRadius: shapeType === 'star' ? 0.5 : undefined,
      // Center the shape on canvas with locked aspect ratio
      transform: {
        x: 0,
        y: 0,
        width: shapeSize,
        height: shapeSize,
        rotation: 0,
        opacity: 1,
        aspectRatioLocked: true,
      },
    };

    addItem(shapeItem);
    // Select the new item
    selectItems([shapeItem.id]);
  }, []);

  // Add adjustment layer to timeline at the best available position
  // Optionally with pre-applied effects and custom label
  const handleAddAdjustmentLayer = useCallback((effects?: VisualEffect[], label?: string) => {
    // Read all needed state from stores directly to avoid subscriptions
    const { tracks, items, fps, addItem } = useTimelineStore.getState();
    const { activeTrackId, selectItems } = useSelectionStore.getState();

    // Use active track if available and not locked, otherwise find first available
    let targetTrack = activeTrackId
      ? tracks.find((t) => t.id === activeTrackId && t.visible !== false && !t.locked)
      : null;

    // Fallback to first available visible/unlocked track
    if (!targetTrack) {
      targetTrack = tracks.find((t) => t.visible !== false && !t.locked);
    }

    if (!targetTrack) {
      console.warn('No available track for adjustment layer');
      return;
    }

    // Default duration: 60 seconds
    const durationInFrames = fps * 60;

    // Find the best position: start at playhead, find nearest available space
    const proposedPosition = usePlaybackStore.getState().currentFrame;
    const finalPosition = findNearestAvailableSpace(
      proposedPosition,
      durationInFrames,
      targetTrack.id,
      items
    ) ?? proposedPosition;

    // Convert VisualEffect[] to ItemEffect[] with IDs
    const itemEffects = effects?.map((effect) => ({
      id: crypto.randomUUID(),
      effect,
      enabled: true,
    })) ?? [];

    // Create a new adjustment layer
    const adjustmentItem: AdjustmentItem = {
      id: crypto.randomUUID(),
      type: 'adjustment',
      trackId: targetTrack.id,
      from: finalPosition,
      durationInFrames,
      label: label ?? 'Adjustment Layer',
      effects: itemEffects,
      effectOpacity: 1,
    };

    addItem(adjustmentItem);
    // Select the new item
    selectItems([adjustmentItem.id]);
  }, []);

  // Effect card configurations with icons
  const effectCards: Array<{
    type: CSSFilterType;
    icon: typeof Sun;
  }> = [
    { type: 'brightness', icon: Sun },
    { type: 'contrast', icon: Contrast },
    { type: 'saturate', icon: Droplets },
    { type: 'blur', icon: Wind },
    { type: 'hue-rotate', icon: Palette },
    { type: 'grayscale', icon: CircleDot },
    { type: 'sepia', icon: ImageOff },
    { type: 'invert', icon: Sparkles },
  ];

  const glitchCards: Array<{
    type: GlitchVariant;
    icon: typeof Zap;
  }> = [
    { type: 'rgb-split', icon: Zap },
    { type: 'scanlines', icon: Scan },
    { type: 'color-glitch', icon: Wand2 },
  ];

  // Create adjustment layer with a CSS filter effect
  const handleAddFilterEffect = useCallback((filterType: CSSFilterType) => {
    const config = CSS_FILTER_CONFIGS[filterType];
    handleAddAdjustmentLayer(
      [{ type: 'css-filter', filter: filterType, value: config.default }],
      config.label
    );
  }, [handleAddAdjustmentLayer]);

  // Create adjustment layer with a glitch effect
  const handleAddGlitchEffect = useCallback((variant: GlitchVariant) => {
    const config = GLITCH_CONFIGS[variant];
    handleAddAdjustmentLayer(
      [{
        type: 'glitch',
        variant,
        intensity: 0.5,
        speed: 1,
        seed: Math.floor(Math.random() * 10000),
      }],
      config.label
    );
  }, [handleAddAdjustmentLayer]);

  // Create adjustment layer with halftone effect
  const handleAddHalftoneEffect = useCallback(() => {
    handleAddAdjustmentLayer(
      [{
        type: 'canvas-effect',
        variant: 'halftone',
        patternType: HALFTONE_CONFIG.patternType.default,
        dotSize: HALFTONE_CONFIG.dotSize.default,
        spacing: HALFTONE_CONFIG.spacing.default,
        angle: HALFTONE_CONFIG.angle.default,
        intensity: HALFTONE_CONFIG.intensity.default,
        softness: HALFTONE_CONFIG.softness.default,
        blendMode: HALFTONE_CONFIG.blendMode.default,
        inverted: HALFTONE_CONFIG.inverted.default,
        fadeAngle: HALFTONE_CONFIG.fadeAngle.default,
        fadeAmount: HALFTONE_CONFIG.fadeAmount.default,
        dotColor: '#000000',
      }],
      'Halftone'
    );
  }, [handleAddAdjustmentLayer]);

  // Create adjustment layer with vignette effect
  const handleAddVignetteEffect = useCallback(() => {
    handleAddAdjustmentLayer(
      [{
        type: 'overlay-effect',
        variant: 'vignette',
        intensity: VIGNETTE_CONFIG.intensity.default,
        size: VIGNETTE_CONFIG.size.default,
        softness: VIGNETTE_CONFIG.softness.default,
        color: '#000000',
        shape: 'elliptical',
      }],
      'Vignette'
    );
  }, [handleAddAdjustmentLayer]);

  // Create adjustment layer with preset effects
  const handleAddPreset = useCallback((presetId: string) => {
    const preset = EFFECT_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    handleAddAdjustmentLayer(preset.effects, preset.name);
  }, [handleAddAdjustmentLayer]);

  // Category items for the vertical nav
  const categories = [
    { id: 'media' as const, icon: Film, label: 'Media' },
    { id: 'text' as const, icon: Type, label: 'Text' },
    { id: 'shapes' as const, icon: Pentagon, label: 'Shapes' },
    { id: 'effects' as const, icon: Layers, label: 'Effects' },
    { id: 'transitions' as const, icon: Blend, label: 'Transitions' },
  ];

  return (
    <div className="flex h-full flex-shrink-0">
      {/* Vertical Category Bar */}
      <div className="w-12 panel-header border-r border-border flex flex-col items-center flex-shrink-0">
        {/* Header row - aligned with content panel header */}
        <div className="h-10 flex items-center justify-center border-b border-border w-full">
          <button
            onClick={toggleLeftSidebar}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
            data-tooltip={leftSidebarOpen ? 'Collapse Panel' : 'Expand Panel'}
            data-tooltip-side="right"
          >
            {leftSidebarOpen ? (
              <ChevronLeft className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
          </button>
        </div>

        {/* Category Icons */}
        <div className="flex flex-col gap-1 py-2">
          {categories.map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              onClick={() => {
                if (activeTab === id && leftSidebarOpen) {
                  toggleLeftSidebar();
                } else {
                  setActiveTab(id);
                  if (!leftSidebarOpen) toggleLeftSidebar();
                }
              }}
              className={`
                w-10 h-10 rounded-lg flex items-center justify-center transition-all
                ${activeTab === id && leftSidebarOpen
                  ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
                }
              `}
              data-tooltip={label}
              data-tooltip-side="right"
            >
              <Icon className="w-5 h-5" />
            </button>
          ))}
        </div>
      </div>

      {/* Content Panel */}
      <div
        className={`panel-bg border-r border-border overflow-hidden relative ${
          leftSidebarOpen ? '' : 'w-0'
        }`}
        style={leftSidebarOpen ? { width: sidebarWidth, transition: isResizingRef.current ? 'none' : 'width 200ms' } : { transition: 'width 200ms' }}
      >
        {/* Use Activity for React 19 performance optimization - defers updates when hidden */}
        <Activity mode={leftSidebarOpen ? 'visible' : 'hidden'}>
          <div className="h-full flex flex-col" style={{ width: sidebarWidth }}>
          {/* Panel Header */}
          <div className="h-10 flex items-center px-3 border-b border-border flex-shrink-0">
            <span className="text-sm font-medium text-foreground">
              {categories.find((c) => c.id === activeTab)?.label}
            </span>
          </div>

          {/* Media Tab - Full Media Library */}
          <div className={`flex-1 overflow-hidden ${activeTab === 'media' ? 'block' : 'hidden'}`}>
            <MediaLibrary />
          </div>

          {/* Text Tab */}
          <div className={`flex-1 overflow-y-auto p-3 ${activeTab === 'text' ? 'block' : 'hidden'}`}>
            <div className="space-y-3">
              <button
                onClick={handleAddText}
                className="w-full flex items-center gap-3 p-3 rounded-lg border border-border bg-secondary/30 hover:bg-secondary/50 hover:border-primary/50 transition-colors group"
              >
                <div className="w-9 h-9 rounded-md bg-timeline-text/20 border border-timeline-text/50 flex items-center justify-center group-hover:bg-timeline-text/30 flex-shrink-0">
                  <Type className="w-4 h-4 text-timeline-text" />
                </div>
                <span className="text-sm text-muted-foreground group-hover:text-foreground">
                  Add Text
                </span>
              </button>
            </div>
          </div>

          {/* Shapes Tab */}
          <div className={`flex-1 overflow-y-auto p-3 ${activeTab === 'shapes' ? 'block' : 'hidden'}`}>
            <div className="grid grid-cols-3 gap-1.5">
                  <button
                    onClick={() => handleAddShape('rectangle')}
                    className="flex flex-col items-center justify-center gap-1 p-2 rounded-lg border border-border bg-secondary/30 hover:bg-secondary/50 hover:border-primary/50 transition-colors group"
                  >
                    <div className="w-7 h-7 rounded border border-border bg-secondary/50 flex items-center justify-center group-hover:bg-secondary/70">
                      <Square className="w-3.5 h-3.5 text-muted-foreground group-hover:text-foreground" />
                    </div>
                    <span className="text-[9px] text-muted-foreground group-hover:text-foreground">
                      Rectangle
                    </span>
                  </button>

                  <button
                    onClick={() => handleAddShape('circle')}
                    className="flex flex-col items-center justify-center gap-1 p-2 rounded-lg border border-border bg-secondary/30 hover:bg-secondary/50 hover:border-primary/50 transition-colors group"
                  >
                    <div className="w-7 h-7 rounded border border-border bg-secondary/50 flex items-center justify-center group-hover:bg-secondary/70">
                      <Circle className="w-3.5 h-3.5 text-muted-foreground group-hover:text-foreground" />
                    </div>
                    <span className="text-[9px] text-muted-foreground group-hover:text-foreground">
                      Circle
                    </span>
                  </button>

                  <button
                    onClick={() => handleAddShape('triangle')}
                    className="flex flex-col items-center justify-center gap-1 p-2 rounded-lg border border-border bg-secondary/30 hover:bg-secondary/50 hover:border-primary/50 transition-colors group"
                  >
                    <div className="w-7 h-7 rounded border border-border bg-secondary/50 flex items-center justify-center group-hover:bg-secondary/70">
                      <Triangle className="w-3.5 h-3.5 text-muted-foreground group-hover:text-foreground" />
                    </div>
                    <span className="text-[9px] text-muted-foreground group-hover:text-foreground">
                      Triangle
                    </span>
                  </button>

                  <button
                    onClick={() => handleAddShape('ellipse')}
                    className="flex flex-col items-center justify-center gap-1 p-2 rounded-lg border border-border bg-secondary/30 hover:bg-secondary/50 hover:border-primary/50 transition-colors group"
                  >
                    <div className="w-7 h-7 rounded border border-border bg-secondary/50 flex items-center justify-center group-hover:bg-secondary/70">
                      <Circle className="w-3.5 h-2.5 text-muted-foreground group-hover:text-foreground" />
                    </div>
                    <span className="text-[9px] text-muted-foreground group-hover:text-foreground">
                      Ellipse
                    </span>
                  </button>

                  <button
                    onClick={() => handleAddShape('star')}
                    className="flex flex-col items-center justify-center gap-1 p-2 rounded-lg border border-border bg-secondary/30 hover:bg-secondary/50 hover:border-primary/50 transition-colors group"
                  >
                    <div className="w-7 h-7 rounded border border-border bg-secondary/50 flex items-center justify-center group-hover:bg-secondary/70">
                      <Star className="w-3.5 h-3.5 text-muted-foreground group-hover:text-foreground" />
                    </div>
                    <span className="text-[9px] text-muted-foreground group-hover:text-foreground">
                      Star
                    </span>
                  </button>

                  <button
                    onClick={() => handleAddShape('polygon')}
                    className="flex flex-col items-center justify-center gap-1 p-2 rounded-lg border border-border bg-secondary/30 hover:bg-secondary/50 hover:border-primary/50 transition-colors group"
                  >
                    <div className="w-7 h-7 rounded border border-border bg-secondary/50 flex items-center justify-center group-hover:bg-secondary/70">
                      <Hexagon className="w-3.5 h-3.5 text-muted-foreground group-hover:text-foreground" />
                    </div>
                    <span className="text-[9px] text-muted-foreground group-hover:text-foreground">
                      Polygon
                    </span>
                  </button>

                  <button
                    onClick={() => handleAddShape('heart')}
                    className="flex flex-col items-center justify-center gap-1 p-2 rounded-lg border border-border bg-secondary/30 hover:bg-secondary/50 hover:border-primary/50 transition-colors group"
                  >
                    <div className="w-7 h-7 rounded border border-border bg-secondary/50 flex items-center justify-center group-hover:bg-secondary/70">
                      <Heart className="w-3.5 h-3.5 text-muted-foreground group-hover:text-foreground" />
                    </div>
                    <span className="text-[9px] text-muted-foreground group-hover:text-foreground">
                      Heart
                    </span>
                  </button>
            </div>
          </div>

          {/* Effects Tab */}
          <div className={`flex-1 overflow-y-auto p-3 ${activeTab === 'effects' ? 'block' : 'hidden'}`}>
            <div className="space-y-4">
              {/* Blank Adjustment Layer */}
              <div>
                <button
                  onClick={() => handleAddAdjustmentLayer()}
                  className="w-full flex items-center gap-3 p-3 rounded-lg border border-border bg-secondary/30 hover:bg-secondary/50 hover:border-primary/50 transition-colors group"
                >
                  <div className="w-9 h-9 rounded-md border border-border bg-secondary/50 flex items-center justify-center group-hover:bg-secondary/70 flex-shrink-0">
                    <Layers className="w-4 h-4 text-muted-foreground group-hover:text-foreground" />
                  </div>
                  <div className="text-left">
                    <div className="text-sm text-muted-foreground group-hover:text-foreground">
                      Blank Adjustment Layer
                    </div>
                    <div className="text-[10px] text-muted-foreground/70">
                      Add effects manually
                    </div>
                  </div>
                </button>
              </div>

              {/* Color Adjustments */}
              <div>
                <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
                  Color Adjustments
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {effectCards.map(({ type, icon: Icon }) => (
                    <button
                      key={type}
                      onClick={() => handleAddFilterEffect(type)}
                      className="flex flex-col items-center justify-center gap-1 p-2 rounded-lg border border-border bg-secondary/30 hover:bg-secondary/50 hover:border-primary/50 transition-colors group"
                    >
                      <div className="w-7 h-7 rounded border border-border bg-secondary/50 flex items-center justify-center group-hover:bg-secondary/70">
                        <Icon className="w-3.5 h-3.5 text-muted-foreground group-hover:text-foreground" />
                      </div>
                      <span className="text-[9px] text-muted-foreground group-hover:text-foreground text-center leading-tight">
                        {CSS_FILTER_CONFIGS[type].label}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Glitch Effects */}
              <div>
                <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
                  Glitch Effects
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {glitchCards.map(({ type, icon: Icon }) => (
                    <button
                      key={type}
                      onClick={() => handleAddGlitchEffect(type)}
                      className="flex flex-col items-center justify-center gap-1 p-2 rounded-lg border border-border bg-secondary/30 hover:bg-secondary/50 hover:border-primary/50 transition-colors group"
                    >
                      <div className="w-7 h-7 rounded border border-border bg-secondary/50 flex items-center justify-center group-hover:bg-secondary/70">
                        <Icon className="w-3.5 h-3.5 text-muted-foreground group-hover:text-foreground" />
                      </div>
                      <span className="text-[9px] text-muted-foreground group-hover:text-foreground text-center leading-tight">
                        {GLITCH_CONFIGS[type].label}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Stylized Effects */}
              <div>
                <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
                  Stylized
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  <button
                    onClick={handleAddHalftoneEffect}
                    className="flex flex-col items-center justify-center gap-1 p-2 rounded-lg border border-border bg-secondary/30 hover:bg-secondary/50 hover:border-primary/50 transition-colors group"
                  >
                    <div className="w-7 h-7 rounded border border-border bg-secondary/50 flex items-center justify-center group-hover:bg-secondary/70">
                      <Grid3X3 className="w-3.5 h-3.5 text-muted-foreground group-hover:text-foreground" />
                    </div>
                    <span className="text-[9px] text-muted-foreground group-hover:text-foreground text-center leading-tight">
                      Halftone
                    </span>
                  </button>
                  <button
                    onClick={handleAddVignetteEffect}
                    className="flex flex-col items-center justify-center gap-1 p-2 rounded-lg border border-border bg-secondary/30 hover:bg-secondary/50 hover:border-primary/50 transition-colors group"
                  >
                    <div className="w-7 h-7 rounded border border-border bg-secondary/50 flex items-center justify-center group-hover:bg-secondary/70">
                      <CircleDot className="w-3.5 h-3.5 text-muted-foreground group-hover:text-foreground" />
                    </div>
                    <span className="text-[9px] text-muted-foreground group-hover:text-foreground text-center leading-tight">
                      Vignette
                    </span>
                  </button>
                </div>
              </div>

              {/* Presets */}
              <div>
                <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
                  Presets
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {EFFECT_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      onClick={() => handleAddPreset(preset.id)}
                      className="flex flex-col items-center justify-center gap-1 p-2 rounded-lg border border-border bg-secondary/30 hover:bg-secondary/50 hover:border-primary/50 transition-colors group"
                    >
                      <div className="w-7 h-7 rounded border border-border bg-secondary/50 flex items-center justify-center group-hover:bg-secondary/70">
                        <Sparkles className="w-3.5 h-3.5 text-muted-foreground group-hover:text-foreground" />
                      </div>
                      <span className="text-[9px] text-muted-foreground group-hover:text-foreground text-center leading-tight">
                        {preset.name}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Transitions Tab */}
          <div className={`flex-1 overflow-hidden ${activeTab === 'transitions' ? 'block' : 'hidden'}`}>
            <TransitionsPanel />
          </div>
          </div>
        </Activity>
        {/* Resize Handle */}
        {leftSidebarOpen && (
          <div
            onMouseDown={handleResizeStart}
            className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/50 active:bg-primary/50 transition-colors z-10"
          />
        )}
      </div>
    </div>
  );
});
