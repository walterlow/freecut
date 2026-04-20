/**
 * Keyframe Graph Panel Component
 *
 * Panel that shows the value graph editor for selected items.
 * Integrates with the timeline to provide visual keyframe editing.
 */

import { memo, useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { useShallow } from 'zustand/react/shallow';
import { cn } from '@/shared/ui/cn';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ErrorBoundary } from '@/components/error-boundary';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DopesheetEditor,
  getBezierPresetForEasing,
  getTransitionBlockedRanges,
  interpolatePropertyValue,
  getAnimatablePropertiesForItem,
} from '@/features/timeline/deps/keyframes';
import {
  resolveTransform,
  getSourceDimensions,
} from '@/features/timeline/deps/composition-runtime';
import { useProjectStore } from '@/features/timeline/deps/projects';
import { useSelectionStore } from '@/shared/state/selection';
import { useItemsStore } from '../stores/items-store';
import { useKeyframesStore } from '../stores/keyframes-store';
import { useTransitionsStore } from '../stores/transitions-store';
import { useKeyframeSelectionStore } from '../stores/keyframe-selection-store';
import { useTimelineCommandStore } from '../stores/timeline-command-store';
import { captureSnapshot } from '../stores/commands/snapshot';
import type { TimelineSnapshot } from '../stores/commands/types';
import { usePlaybackStore } from '@/shared/state/playback';
import { useEditorStore } from '@/app/state/editor';
import { useTimelineSettingsStore } from '../stores/timeline-settings-store';
import {
  DEFAULT_BEZIER_POINTS,
  DEFAULT_SPRING_PARAMS,
} from '@/types/keyframe';
import type {
  AnimatableProperty,
  BezierControlPoints,
  EasingConfig,
  EasingType,
  Keyframe,
  KeyframeRef,
  SpringParameters,
} from '@/types/keyframe';
import type { CanvasSettings } from '@/types/transform';
import type { TimelineItem } from '@/types/timeline';
import * as timelineActions from '../stores/timeline-actions';
import { HOTKEY_OPTIONS } from '@/config/hotkeys';
import { useResolvedHotkeys } from '@/features/timeline/deps/settings';

/** Height of the panel header bar in pixels */
const GRAPH_PANEL_HEADER_HEIGHT = 32;

/** Height of the resize handle in pixels */
const RESIZE_HANDLE_HEIGHT = 6;

/** Default ratio of parent height for the graph content area */
const DEFAULT_PARENT_RATIO = 0.6;

/** Minimum content height */
const MIN_CONTENT_HEIGHT = 100;

/** Fallback maximum content height when parent size is unknown */
const MAX_CONTENT_HEIGHT_FALLBACK = 500;

/** Maximum ratio the panel can occupy of its parent container */
const MAX_PARENT_RATIO = 0.8;

interface KeyframeGraphPanelProps {
  /** Whether the panel is open */
  isOpen: boolean;
  /** Deprecated: panel no longer collapses from the header */
  onToggle?: () => void;
  /** Callback to close the panel */
  onClose: () => void;
  /** Where the panel is docked in the layout */
  placement?: 'bottom' | 'top';
}

type KeyframeEditorMode = 'graph' | 'dopesheet';
const KEYFRAME_EDITOR_MODE_STORAGE_KEY = 'timeline:keyframeEditorMode';
const EASING_OPTIONS: Array<{ value: EasingType; label: string }> = [
  { value: 'linear', label: 'Linear' },
  { value: 'ease-in', label: 'Ease In' },
  { value: 'ease-in-out', label: 'Ease In-Out' },
  { value: 'ease-out', label: 'Ease Out' },
];
const BEZIER_PRESETS = [
  { value: 'soft', label: 'Soft', points: { x1: 0.42, y1: 0, x2: 0.58, y2: 1 } },
  { value: 'ease-out', label: 'Ease Out', points: { x1: 0.215, y1: 0.61, x2: 0.355, y2: 1 } },
  { value: 'ease-in', label: 'Ease In', points: { x1: 0.55, y1: 0.055, x2: 0.675, y2: 0.19 } },
  { value: 'ease-in-out', label: 'Ease In-Out', points: { x1: 0.645, y1: 0.045, x2: 0.355, y2: 1 } },
  { value: 'overshoot', label: 'Overshoot', points: { x1: 0.34, y1: 1.56, x2: 0.64, y2: 1 } },
] as const;
const BEZIER_INPUT_KEYS = ['x1', 'y1', 'x2', 'y2'] as const;
const SPRING_INPUT_KEYS = ['tension', 'friction', 'mass'] as const;

type BezierInputKey = (typeof BEZIER_INPUT_KEYS)[number];
type SpringInputKey = (typeof SPRING_INPUT_KEYS)[number];
type BezierPresetValue = (typeof BEZIER_PRESETS)[number]['value'] | 'custom';

function clampFrameToBlockedRanges(
  frame: number,
  initialFrame: number,
  blockedRanges: ReturnType<typeof getTransitionBlockedRanges>
): number {
  for (const range of blockedRanges) {
    if (frame >= range.start && frame < range.end) {
      if (initialFrame < range.start) return range.start - 1;
      if (initialFrame >= range.end) return range.end;
      const distToStart = frame - range.start;
      const distToEnd = range.end - frame;
      return distToStart < distToEnd ? range.start - 1 : range.end;
    }
  }
  return frame;
}

function getBaseKeyframeValue(
  item: TimelineItem,
  property: AnimatableProperty,
  canvas: CanvasSettings
): number {
  if (property === 'volume') {
    return item.volume ?? 0;
  }

  const resolved = resolveTransform(item, canvas, getSourceDimensions(item));
  return resolved[property];
}

function buildEasingConfig(
  easing: EasingType,
  existingConfig?: EasingConfig
): EasingConfig | undefined {
  const presetBezier = getBezierPresetForEasing(easing);
  if (presetBezier) {
    return {
      type: 'cubic-bezier',
      bezier: presetBezier,
    };
  }

  if (easing === 'cubic-bezier') {
    return {
      type: 'cubic-bezier',
      bezier:
        existingConfig?.type === 'cubic-bezier' && existingConfig.bezier
          ? existingConfig.bezier
          : { ...DEFAULT_BEZIER_POINTS },
    };
  }

  if (easing === 'spring') {
    return {
      type: 'spring',
      spring:
        existingConfig?.type === 'spring' && existingConfig.spring
          ? existingConfig.spring
          : { ...DEFAULT_SPRING_PARAMS },
    };
  }

  return undefined;
}

function areBezierPointsEqual(a: BezierControlPoints, b: BezierControlPoints): boolean {
  return (
    a.x1 === b.x1 &&
    a.y1 === b.y1 &&
    a.x2 === b.x2 &&
    a.y2 === b.y2
  );
}

function clampBezierValue(key: BezierInputKey, value: number): number {
  if (key === 'x1' || key === 'x2') {
    return Math.max(0, Math.min(1, value));
  }
  return Math.max(-2, Math.min(3, value));
}

function clampSpringValue(key: SpringInputKey, value: number): number {
  switch (key) {
    case 'tension':
      return Math.max(1, Math.min(500, value));
    case 'friction':
      return Math.max(1, Math.min(100, value));
    case 'mass':
      return Math.max(0.1, Math.min(10, value));
  }
}

function toBezierDraft(points: BezierControlPoints): Record<BezierInputKey, string> {
  return {
    x1: String(points.x1),
    y1: String(points.y1),
    x2: String(points.x2),
    y2: String(points.y2),
  };
}

function toSpringDraft(params: SpringParameters): Record<SpringInputKey, string> {
  return {
    tension: String(params.tension),
    friction: String(params.friction),
    mass: String(params.mass),
  };
}

function loadKeyframeEditorMode(): KeyframeEditorMode {
  try {
    const value = localStorage.getItem(KEYFRAME_EDITOR_MODE_STORAGE_KEY);
    if (value === 'graph' || value === 'dopesheet') {
      return value;
    }
    if (value === 'split') {
      return 'dopesheet';
    }
  } catch {
    // ignore localStorage read errors
  }
  return 'graph';
}

interface AdvancedEasingControlsProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
  selectedBezierPoints: BezierControlPoints | null;
  selectedBezierPreset: BezierPresetValue;
  hasMixedBezierConfig: boolean;
  selectedSpringParameters: SpringParameters | null;
  hasMixedSpringConfig: boolean;
  applyBezier: (bezier: BezierControlPoints) => void;
  applySpring: (spring: SpringParameters) => void;
}

function AdvancedEasingControls({
  containerRef,
  selectedBezierPoints,
  selectedBezierPreset,
  hasMixedBezierConfig,
  selectedSpringParameters,
  hasMixedSpringConfig,
  applyBezier,
  applySpring,
}: AdvancedEasingControlsProps) {
  const [bezierDraft, setBezierDraft] = useState<Record<BezierInputKey, string>>(
    () => selectedBezierPoints ? toBezierDraft(selectedBezierPoints) : toBezierDraft(DEFAULT_BEZIER_POINTS)
  );
  const [springDraft, setSpringDraft] = useState<Record<SpringInputKey, string>>(
    () => selectedSpringParameters ? toSpringDraft(selectedSpringParameters) : toSpringDraft(DEFAULT_SPRING_PARAMS)
  );

  const handleBezierPresetChange = useCallback((value: string) => {
    if (value === 'custom') return;

    const preset = BEZIER_PRESETS.find((candidate) => candidate.value === value);
    if (!preset) return;

    setBezierDraft(toBezierDraft(preset.points));
    applyBezier({ ...preset.points });
  }, [applyBezier]);

  const handleBezierDraftChange = useCallback((key: BezierInputKey, value: string) => {
    setBezierDraft((prev) => ({ ...prev, [key]: value }));
  }, []);

  const commitBezierDraft = useCallback((key: BezierInputKey) => {
    if (!selectedBezierPoints) return;

    const parsed = Number(bezierDraft[key]);
    if (!Number.isFinite(parsed)) {
      setBezierDraft((prev) => ({
        ...prev,
        [key]: String(selectedBezierPoints[key]),
      }));
      return;
    }

    const nextBezier = {
      ...selectedBezierPoints,
      [key]: clampBezierValue(key, parsed),
    };

    setBezierDraft(toBezierDraft(nextBezier));
    applyBezier(nextBezier);
  }, [applyBezier, bezierDraft, selectedBezierPoints]);

  const handleSpringDraftChange = useCallback((key: SpringInputKey, value: string) => {
    setSpringDraft((prev) => ({ ...prev, [key]: value }));
  }, []);

  const commitSpringDraft = useCallback((key: SpringInputKey) => {
    if (!selectedSpringParameters) return;

    const parsed = Number(springDraft[key]);
    if (!Number.isFinite(parsed)) {
      setSpringDraft((prev) => ({
        ...prev,
        [key]: String(selectedSpringParameters[key]),
      }));
      return;
    }

    const nextSpring = {
      ...selectedSpringParameters,
      [key]: clampSpringValue(key, parsed),
    };

    setSpringDraft(toSpringDraft(nextSpring));
    applySpring(nextSpring);
  }, [applySpring, selectedSpringParameters, springDraft]);

  const handleDraftKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>, commit: () => void) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        commit();
        event.currentTarget.blur();
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        event.currentTarget.blur();
      }
    },
    []
  );

  return (
    <div
      ref={containerRef}
      className="mb-2 rounded-md border border-border bg-secondary/20 px-2 py-1.5"
    >
      {selectedBezierPoints && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-medium text-foreground">Bezier</span>
          <Select value={selectedBezierPreset} onValueChange={handleBezierPresetChange}>
            <SelectTrigger className="h-7 w-[130px] text-xs focus:ring-0 focus:ring-offset-0">
              <SelectValue placeholder="Preset" />
            </SelectTrigger>
            <SelectContent>
              {BEZIER_PRESETS.map((preset) => (
                <SelectItem key={preset.value} value={preset.value} className="text-xs">
                  {preset.label}
                </SelectItem>
              ))}
              <SelectItem value="custom" className="text-xs">
                Custom
              </SelectItem>
            </SelectContent>
          </Select>
          {BEZIER_INPUT_KEYS.map((key) => (
            <label key={key} className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <span className="uppercase">{key}</span>
              <Input
                value={bezierDraft[key]}
                onChange={(event) => handleBezierDraftChange(key, event.target.value)}
                onBlur={() => commitBezierDraft(key)}
                onKeyDown={(event) => handleDraftKeyDown(event, () => commitBezierDraft(key))}
                className="h-7 w-16 px-2 text-xs"
                inputMode="decimal"
              />
            </label>
          ))}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-[11px]"
            onClick={() => handleBezierPresetChange('soft')}
          >
            Reset
          </Button>
          <span className="text-[11px] text-muted-foreground">
            {hasMixedBezierConfig ? 'Mixed curves selected' : 'Drag graph handles for custom curves'}
          </span>
        </div>
      )}
      {selectedSpringParameters && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-medium text-foreground">Spring</span>
          {SPRING_INPUT_KEYS.map((key) => (
            <label key={key} className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <span className="capitalize">{key}</span>
              <Input
                value={springDraft[key]}
                onChange={(event) => handleSpringDraftChange(key, event.target.value)}
                onBlur={() => commitSpringDraft(key)}
                onKeyDown={(event) => handleDraftKeyDown(event, () => commitSpringDraft(key))}
                className={cn(
                  'h-7 px-2 text-xs',
                  key === 'mass' ? 'w-16' : 'w-[72px]'
                )}
                inputMode="decimal"
              />
            </label>
          ))}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-[11px]"
            onClick={() => {
              setSpringDraft(toSpringDraft(DEFAULT_SPRING_PARAMS));
              applySpring({ ...DEFAULT_SPRING_PARAMS });
            }}
          >
            Reset
          </Button>
          <span className="text-[11px] text-muted-foreground">
            {hasMixedSpringConfig ? 'Mixed spring settings selected' : 'Lower friction increases bounce'}
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * Panel showing the keyframe value graph editor.
 * Displays graph for the first selected item that has keyframes.
 * Automatically uses full width of container.
 */
export const KeyframeGraphPanel = memo(function KeyframeGraphPanel({
  isOpen,
  onClose,
  placement = 'bottom',
}: KeyframeGraphPanelProps) {
  const hotkeys = useResolvedHotkeys();
  // Ref to measure container width
  const containerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [parentHeight, setParentHeight] = useState(0);
  const hasInitialSized = useRef(false);

  // Track content height (user can resize)
  const [contentHeight, setContentHeight] = useState(MIN_CONTENT_HEIGHT);

  // Dynamic max: 80% of parent minus the header and handle chrome
  const chrome = GRAPH_PANEL_HEADER_HEIGHT + RESIZE_HANDLE_HEIGHT;
  const maxContentHeight = parentHeight > 0
    ? Math.max(MIN_CONTENT_HEIGHT, Math.floor(parentHeight * MAX_PARENT_RATIO) - chrome)
    : MAX_CONTENT_HEIGHT_FALLBACK;

  // Set default height to 60% of parent on first measurement
  useEffect(() => {
    if (parentHeight > 0 && !hasInitialSized.current) {
      hasInitialSized.current = true;
      const defaultHeight = Math.floor(parentHeight * DEFAULT_PARENT_RATIO) - chrome;
      setContentHeight(Math.max(MIN_CONTENT_HEIGHT, Math.min(maxContentHeight, defaultHeight)));
    }
  }, [parentHeight, chrome, maxContentHeight]);

  // Resize state
  const [isResizing, setIsResizing] = useState(false);
  const resizeStartY = useRef(0);
  const resizeStartHeight = useRef(0);

  // Measure container width on mount and resize
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateWidth = () => {
      setContainerWidth(container.clientWidth);
    };

    // Initial measurement
    updateWidth();

    // Use ResizeObserver to track size changes
    const resizeObserver = new ResizeObserver(updateWidth);
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
    };
  }, [isOpen]); // Re-measure when panel opens

  // Measure parent height so the panel can cap at MAX_PARENT_RATIO
  useEffect(() => {
    const panel = panelRef.current;
    const parent = panel?.parentElement;
    if (!parent) return;

    const update = () => setParentHeight(parent.clientHeight);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(parent);
    return () => observer.disconnect();
  }, [isOpen]);

  // Handle resize drag
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);
    resizeStartY.current = e.clientY;
    resizeStartHeight.current = contentHeight;
  }, [contentHeight]);

  // Handle resize move and end via document events
  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaY = placement === 'top'
        ? e.clientY - resizeStartY.current
        : resizeStartY.current - e.clientY;
      const newHeight = Math.min(
        maxContentHeight,
        Math.max(MIN_CONTENT_HEIGHT, resizeStartHeight.current + deltaY)
      );
      setContentHeight(newHeight);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      // Note: We intentionally do NOT call onHeightChange during resize
      // The timeline panel should only resize when the graph panel is opened/closed,
      // not when the user drags the resize handle within the existing space
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, placement, maxContentHeight]);

  // Selected items
  const selectedItemIds = useSelectionStore((s) => s.selectedItemIds);

  const selectedItemForEditor = useItemsStore(
    useCallback((s) => {
      for (const itemId of selectedItemIds) {
        const item = s.itemById[itemId];
        if (item) {
          return item;
        }
      }

      return null;
    }, [selectedItemIds])
  );
  const selectedItemKeyframes = useKeyframesStore(
    useCallback(
      (s) => selectedItemForEditor ? (s.keyframesByItemId[selectedItemForEditor.id] ?? null) : null,
      [selectedItemForEditor]
    )
  );
  const selectedItemTransitions = useTransitionsStore(
    useShallow(
      useCallback((s) => {
        if (!selectedItemForEditor) return [];

        return s.transitions.filter(
          (transition) => transition.leftClipId === selectedItemForEditor.id
            || transition.rightClipId === selectedItemForEditor.id
        );
      }, [selectedItemForEditor])
    )
  );

  // Use _updateKeyframe directly (no undo per call) for dragging
  const _updateKeyframe = useKeyframesStore((s) => s._updateKeyframe);
  const currentProject = useProjectStore((s) => s.currentProject);
  const setKeyframeEditorShortcutScopeActive = useEditorStore((s) => s.setKeyframeEditorShortcutScopeActive);

  // Ref to store snapshot captured on drag start for undo batching
  const dragSnapshotRef = useRef<TimelineSnapshot | null>(null);
  const [isPointerWithinEditor, setIsPointerWithinEditor] = useState(false);
  const [isFocusWithinEditor, setIsFocusWithinEditor] = useState(false);

  // Keyframe selection
  const selectedKeyframes = useKeyframeSelectionStore((s) => s.selectedKeyframes);
  const selectKeyframe = useKeyframeSelectionStore((s) => s.selectKeyframe);
  const selectKeyframes = useKeyframeSelectionStore((s) => s.selectKeyframes);
  const clearKeyframeSelection = useKeyframeSelectionStore((s) => s.clearSelection);
  const keyframeClipboard = useKeyframeSelectionStore((s) => s.clipboard);
  const isKeyframeClipboardCut = useKeyframeSelectionStore((s) => s.isCut);
  const copySelectedKeyframes = useKeyframeSelectionStore((s) => s.copySelectedKeyframes);
  const cutSelectedKeyframes = useKeyframeSelectionStore((s) => s.cutSelectedKeyframes);
  const clearKeyframeClipboard = useKeyframeSelectionStore((s) => s.clearClipboard);

  // Playback state
  const currentFrame = usePlaybackStore((s) => s.currentFrame);

  // Track selected property for graph editor
  const [selectedProperty, setSelectedProperty] = useState<AnimatableProperty | null>(null);
  const [editorMode, setEditorMode] = useState<KeyframeEditorMode>(() => loadKeyframeEditorMode());
  const [advancedControlsHeight, setAdvancedControlsHeight] = useState(0);
  const advancedControlsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem(KEYFRAME_EDITOR_MODE_STORAGE_KEY, editorMode);
    } catch {
      // ignore localStorage write errors
    }
  }, [editorMode]);

  useEffect(() => {
    if (!isOpen) {
      setIsPointerWithinEditor(false);
      setIsFocusWithinEditor(false);
      setKeyframeEditorShortcutScopeActive(false);
      return;
    }

    setKeyframeEditorShortcutScopeActive(isPointerWithinEditor || isFocusWithinEditor);
  }, [
    isFocusWithinEditor,
    isOpen,
    isPointerWithinEditor,
    setKeyframeEditorShortcutScopeActive,
  ]);

  useEffect(
    () => () => {
      setKeyframeEditorShortcutScopeActive(false);
    },
    [setKeyframeEditorShortcutScopeActive]
  );

  const canvas = useMemo<CanvasSettings>(() => ({
    width: currentProject?.metadata.width ?? 1920,
    height: currentProject?.metadata.height ?? 1080,
    fps: currentProject?.metadata.fps ?? 30,
  }), [currentProject]);

  const availableProperties = useMemo(
    () => selectedItemForEditor ? getAnimatablePropertiesForItem(selectedItemForEditor) : [],
    [selectedItemForEditor]
  );
  const effectiveSelectedProperty = useMemo(
    () => (
      selectedProperty && availableProperties.includes(selectedProperty)
        ? selectedProperty
        : null
    ),
    [availableProperties, selectedProperty]
  );

  // Build keyframes by property for the graph editor
  const keyframesByProperty = useMemo(() => {
    if (!selectedItemForEditor) return {};

    const keyframesByPropertyMap = new Map<AnimatableProperty, Keyframe[]>(
      (selectedItemKeyframes?.properties ?? []).map((property) => [property.property, property.keyframes])
    );
    const result: Partial<Record<AnimatableProperty, Keyframe[]>> = {};

    for (const property of availableProperties) {
      result[property] = keyframesByPropertyMap.get(property) ?? [];
    }

    return result;
  }, [availableProperties, selectedItemForEditor, selectedItemKeyframes]);

  // Selected keyframe IDs for the current item
  const selectedKeyframeIds = useMemo(() => {
    if (!selectedItemForEditor) return new Set<string>();

    const ids = new Set<string>();
    for (const ref of selectedKeyframes) {
      if (ref.itemId === selectedItemForEditor.id) {
        ids.add(ref.keyframeId);
      }
    }
    return ids;
  }, [selectedKeyframes, selectedItemForEditor]);

  const selectedEditorKeyframes = useMemo(() => {
    if (!selectedItemForEditor || !selectedItemKeyframes) return [];

    const entries: Array<{ ref: KeyframeRef; keyframe: Keyframe }> = [];
    for (const ref of selectedKeyframes) {
      if (ref.itemId !== selectedItemForEditor.id) continue;

      const keyframe = selectedItemKeyframes.properties
        .find((property) => property.property === ref.property)
        ?.keyframes.find((candidate) => candidate.id === ref.keyframeId);

      if (keyframe) {
        entries.push({ ref, keyframe });
      }
    }

    return entries;
  }, [selectedItemForEditor, selectedItemKeyframes, selectedKeyframes]);

  const selectedEditorEasing = useMemo(() => {
    if (selectedEditorKeyframes.length === 0) return undefined;

    const firstEasing = selectedEditorKeyframes[0]?.keyframe.easing;
    if (!firstEasing) return undefined;

    return selectedEditorKeyframes.every(({ keyframe }) => keyframe.easing === firstEasing)
      ? firstEasing
      : undefined;
  }, [selectedEditorKeyframes]);

  const selectedBezierPoints = useMemo(() => {
    if (selectedEditorEasing !== 'cubic-bezier' || selectedEditorKeyframes.length === 0) {
      return null;
    }

    const first = buildEasingConfig('cubic-bezier', selectedEditorKeyframes[0]?.keyframe.easingConfig);
    if (first?.type !== 'cubic-bezier' || !first.bezier) {
      return { ...DEFAULT_BEZIER_POINTS };
    }

    return first.bezier;
  }, [selectedEditorEasing, selectedEditorKeyframes]);

  const selectedBezierPreset = useMemo<BezierPresetValue>(() => {
    if (!selectedBezierPoints) return 'custom';

    const match = BEZIER_PRESETS.find((preset) => areBezierPointsEqual(preset.points, selectedBezierPoints));
    return match?.value ?? 'custom';
  }, [selectedBezierPoints]);

  const hasMixedBezierConfig = useMemo(() => {
    if (!selectedBezierPoints) return false;

    return selectedEditorKeyframes.some(({ keyframe }) => {
      const config = buildEasingConfig('cubic-bezier', keyframe.easingConfig);
      return !config?.bezier || !areBezierPointsEqual(config.bezier, selectedBezierPoints);
    });
  }, [selectedBezierPoints, selectedEditorKeyframes]);

  const selectedSpringParameters = useMemo<SpringParameters | null>(() => {
    if (selectedEditorEasing !== 'spring' || selectedEditorKeyframes.length === 0) {
      return null;
    }

    const first = buildEasingConfig('spring', selectedEditorKeyframes[0]?.keyframe.easingConfig);
    if (first?.type !== 'spring' || !first.spring) {
      return { ...DEFAULT_SPRING_PARAMS };
    }

    return first.spring;
  }, [selectedEditorEasing, selectedEditorKeyframes]);

  const hasMixedSpringConfig = useMemo(() => {
    if (!selectedSpringParameters) return false;

    return selectedEditorKeyframes.some(({ keyframe }) => {
      const config = buildEasingConfig('spring', keyframe.easingConfig);
      const spring = config?.spring;
      return (
        !spring ||
        spring.tension !== selectedSpringParameters.tension ||
        spring.friction !== selectedSpringParameters.friction ||
        spring.mass !== selectedSpringParameters.mass
      );
    });
  }, [selectedEditorKeyframes, selectedSpringParameters]);

  // Calculate relative frame for the current item
  const relativeFrame = useMemo(() => {
    if (!selectedItemForEditor) return 0;
    return Math.max(0, currentFrame - selectedItemForEditor.from);
  }, [currentFrame, selectedItemForEditor]);

  // Calculate transition-blocked frame ranges for the selected item
  const transitionBlockedRanges = useMemo(() => {
    if (!selectedItemForEditor) return [];
    return getTransitionBlockedRanges(
      selectedItemForEditor.id,
      selectedItemForEditor,
      selectedItemTransitions
    );
  }, [selectedItemForEditor, selectedItemTransitions]);

  useEffect(() => {
    const node = advancedControlsRef.current;
    if (!node) {
      setAdvancedControlsHeight(0);
      return;
    }

    const updateHeight = () => {
      setAdvancedControlsHeight(node.offsetHeight);
    };

    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(node);

    return () => observer.disconnect();
  }, [selectedEditorEasing, selectedEditorKeyframes.length, containerWidth]);

  // Handle drag start - capture snapshot for undo batching
  const handleDragStart = useCallback(() => {
    dragSnapshotRef.current = captureSnapshot();
  }, []);

  // Handle drag end - commit undo entry with pre-captured snapshot
  const handleDragEnd = useCallback(() => {
    const beforeSnapshot = dragSnapshotRef.current;
    if (beforeSnapshot) {
      useTimelineCommandStore.getState().addUndoEntry(
        { type: 'MOVE_KEYFRAME_GRAPH', payload: {} },
        beforeSnapshot
      );
      useTimelineSettingsStore.getState().markDirty();
      dragSnapshotRef.current = null;
    }
  }, []);

  // Handle keyframe move in graph editor (no undo per call - batched via drag start/end)
  const handleKeyframeMove = useCallback(
    (ref: KeyframeRef, newFrame: number, newValue: number) => {
      const existingKeyframe = selectedItemKeyframes?.properties
        .find((property) => property.property === ref.property)
        ?.keyframes.find((keyframe) => keyframe.id === ref.keyframeId);
      const initialFrame = existingKeyframe?.frame ?? newFrame;
      const clampedFrame = clampFrameToBlockedRanges(
        Math.max(0, Math.round(newFrame)),
        initialFrame,
        transitionBlockedRanges
      );

      _updateKeyframe(ref.itemId, ref.property, ref.keyframeId, {
        frame: clampedFrame,
        value: newValue,
      });
    },
    [_updateKeyframe, selectedItemKeyframes, transitionBlockedRanges]
  );

  const handleBezierHandleMove = useCallback(
    (ref: KeyframeRef, bezier: BezierControlPoints) => {
      const existingKeyframe = selectedItemKeyframes?.properties
        .find((property) => property.property === ref.property)
        ?.keyframes.find((keyframe) => keyframe.id === ref.keyframeId);
      const nextEasing = existingKeyframe?.easing;

      _updateKeyframe(ref.itemId, ref.property, ref.keyframeId, {
        easing:
          nextEasing === 'ease-in' ||
          nextEasing === 'ease-out' ||
          nextEasing === 'ease-in-out' ||
          nextEasing === 'linear'
            ? nextEasing
            : 'cubic-bezier',
        easingConfig: {
          type: 'cubic-bezier',
          bezier,
        },
      });
    },
    [_updateKeyframe, selectedItemKeyframes]
  );

  // Handle selection change in graph editor
  const handleSelectionChange = useCallback(
    (keyframeIds: Set<string>) => {
      if (!selectedItemForEditor) return;

      const refs: KeyframeRef[] = [];
      for (const id of keyframeIds) {
        // Find which property this keyframe belongs to
        for (const prop of selectedItemKeyframes?.properties ?? []) {
          const kf = prop.keyframes.find((k) => k.id === id);
          if (kf) {
            refs.push({
              itemId: selectedItemForEditor.id,
              property: prop.property,
              keyframeId: id,
            });
            break;
          }
        }
      }

      if (refs.length === 0) {
        clearKeyframeSelection();
      } else if (refs.length === 1 && refs[0]) {
        selectKeyframe(refs[0]);
      } else if (refs.length > 1) {
        selectKeyframes(refs);
      }
    },
    [selectedItemForEditor, selectedItemKeyframes, clearKeyframeSelection, selectKeyframe, selectKeyframes]
  );

  // Handle property change in graph editor
  const handlePropertyChange = useCallback((property: AnimatableProperty | null) => {
    setSelectedProperty(property);
  }, []);

  const handleCopyKeyframes = useCallback(() => {
    if (selectedEditorKeyframes.length === 0) return;
    copySelectedKeyframes();
  }, [copySelectedKeyframes, selectedEditorKeyframes.length]);

  const handleCutKeyframes = useCallback(() => {
    if (selectedEditorKeyframes.length === 0) return;
    cutSelectedKeyframes();
  }, [cutSelectedKeyframes, selectedEditorKeyframes.length]);

  const handleSelectedKeyframeEasingChange = useCallback(
    (value: string) => {
      if (selectedEditorKeyframes.length === 0) return;

      const easing = value as EasingType;
      timelineActions.updateKeyframes(
        selectedEditorKeyframes.map(({ ref, keyframe }) => ({
          itemId: ref.itemId,
          property: ref.property,
          keyframeId: ref.keyframeId,
          updates: {
            easing,
            easingConfig: buildEasingConfig(easing, keyframe.easingConfig),
          },
        }))
      );
    },
    [selectedEditorKeyframes]
  );

  const applySelectedKeyframeUpdates = useCallback(
    (
      buildUpdates: (keyframe: Keyframe, ref: KeyframeRef) => Partial<Omit<Keyframe, 'id'>>
    ) => {
      if (selectedEditorKeyframes.length === 0) return;

      timelineActions.updateKeyframes(
        selectedEditorKeyframes.map(({ ref, keyframe }) => ({
          itemId: ref.itemId,
          property: ref.property,
          keyframeId: ref.keyframeId,
          updates: buildUpdates(keyframe, ref),
        }))
      );
    },
    [selectedEditorKeyframes]
  );

  const applyBezierToSelection = useCallback((bezier: BezierControlPoints) => {
    applySelectedKeyframeUpdates(() => ({
      easing: 'cubic-bezier',
      easingConfig: {
        type: 'cubic-bezier',
        bezier,
      },
    }));
  }, [applySelectedKeyframeUpdates]);

  const applySpringToSelection = useCallback((spring: SpringParameters) => {
    applySelectedKeyframeUpdates(() => ({
      easing: 'spring',
      easingConfig: {
        type: 'spring',
        spring,
      },
    }));
  }, [applySelectedKeyframeUpdates]);

  const handlePasteKeyframes = useCallback(() => {
    if (!selectedItemForEditor || !keyframeClipboard || keyframeClipboard.keyframes.length === 0) {
      return;
    }

    const isBlockedFrame = (frame: number) =>
      transitionBlockedRanges.some((range) => frame >= range.start && frame < range.end);

    const anchorFrame = Math.max(
      0,
      Math.min(selectedItemForEditor.durationInFrames - 1, relativeFrame)
    );
    const payloads: Array<{
      itemId: string;
      property: AnimatableProperty;
      frame: number;
      value: number;
      easing: EasingType;
      easingConfig?: EasingConfig;
    }> = [];
    let skippedUnsupported = 0;
    let skippedBlocked = 0;

    keyframeClipboard.keyframes.forEach((keyframe) => {
      if (!availableProperties.includes(keyframe.property)) {
        skippedUnsupported += 1;
        return;
      }

      const frame = Math.max(
        0,
        Math.min(selectedItemForEditor.durationInFrames - 1, anchorFrame + keyframe.frame)
      );

      if (isBlockedFrame(frame)) {
        skippedBlocked += 1;
        return;
      }

      payloads.push({
        itemId: selectedItemForEditor.id,
        property: keyframe.property,
        frame,
        value: keyframe.value,
        easing: keyframe.easing,
        easingConfig: keyframe.easingConfig,
      });
    });

    if (isKeyframeClipboardCut && (skippedUnsupported > 0 || skippedBlocked > 0)) {
      const reasons: string[] = [];
      if (skippedUnsupported > 0) {
        reasons.push(`${skippedUnsupported} unsupported by the selected clip`);
      }
      if (skippedBlocked > 0) {
        reasons.push(`${skippedBlocked} blocked by transition regions`);
      }

      toast.warning('Unable to paste cut keyframes here', {
        description: `${reasons.join('. ')}. The cut keyframes stay in the clipboard.`,
      });
      return;
    }

    if (payloads.length === 0) {
      const reasons: string[] = [];
      if (skippedUnsupported > 0) {
        reasons.push(
          `${skippedUnsupported} unsupported by the selected clip`
        );
      }
      if (skippedBlocked > 0) {
        reasons.push(
          `${skippedBlocked} blocked by transition regions`
        );
      }

      toast.warning('No keyframes pasted', {
        description: reasons.join('. '),
      });
      return;
    }

    const insertedIds = timelineActions.addKeyframes(payloads);
    const insertedRefs = insertedIds.map((keyframeId, index) => ({
      itemId: selectedItemForEditor.id,
      property: payloads[index]!.property,
      keyframeId,
    }));

    if (insertedRefs.length > 0) {
      selectKeyframes(insertedRefs);
    } else {
      clearKeyframeSelection();
    }

    if (isKeyframeClipboardCut) {
      clearKeyframeClipboard();
    }

    const pastedCount = insertedRefs.length;
    const skippedCount = skippedUnsupported + skippedBlocked;
    const actionLabel = isKeyframeClipboardCut ? 'Moved' : 'Pasted';
    const keyframeLabel = `${pastedCount} keyframe${pastedCount === 1 ? '' : 's'}`;

    if (skippedCount > 0) {
      const reasons: string[] = [];
      if (skippedUnsupported > 0) {
        reasons.push(
          `${skippedUnsupported} unsupported by the selected clip`
        );
      }
      if (skippedBlocked > 0) {
        reasons.push(
          `${skippedBlocked} blocked by transition regions`
        );
      }

      toast.warning(`${actionLabel} ${keyframeLabel}`, {
        description: `${skippedCount} skipped. ${reasons.join('. ')}`,
      });
      return;
    }

    toast.success(`${actionLabel} ${keyframeLabel}`);
  }, [
    availableProperties,
    clearKeyframeClipboard,
    clearKeyframeSelection,
    isKeyframeClipboardCut,
    keyframeClipboard,
    relativeFrame,
    selectKeyframes,
    selectedItemForEditor,
    transitionBlockedRanges,
  ]);

  useHotkeys(
    hotkeys.KEYFRAME_EDITOR_GRAPH,
    (event) => {
      event.preventDefault();
      setEditorMode('graph');
    },
    { ...HOTKEY_OPTIONS, enabled: isOpen },
    [isOpen]
  );

  useHotkeys(
    hotkeys.KEYFRAME_EDITOR_DOPESHEET,
    (event) => {
      event.preventDefault();
      setEditorMode('dopesheet');
    },
    { ...HOTKEY_OPTIONS, enabled: isOpen },
    [isOpen]
  );

  useHotkeys(
    hotkeys.COPY,
    (event) => {
      event.preventDefault();
      handleCopyKeyframes();
    },
    {
      ...HOTKEY_OPTIONS,
      enabled: isOpen && selectedEditorKeyframes.length > 0,
    },
    [handleCopyKeyframes, isOpen, selectedEditorKeyframes.length]
  );

  useHotkeys(
    hotkeys.CUT,
    (event) => {
      event.preventDefault();
      handleCutKeyframes();
    },
    {
      ...HOTKEY_OPTIONS,
      enabled: isOpen && selectedEditorKeyframes.length > 0,
    },
    [handleCutKeyframes, isOpen, selectedEditorKeyframes.length]
  );

  useHotkeys(
    hotkeys.PASTE,
    (event) => {
      event.preventDefault();
      handlePasteKeyframes();
    },
    {
      ...HOTKEY_OPTIONS,
      enabled: isOpen && !!selectedItemForEditor && !!keyframeClipboard,
    },
    [handlePasteKeyframes, isOpen, keyframeClipboard, selectedItemForEditor]
  );

  // Handle scrubbing in graph editor - convert clip-relative frame to absolute frame
  const handleScrub = useCallback(
    (clipRelativeFrame: number) => {
      if (!selectedItemForEditor) return;
      
      // Convert clip-relative frame to absolute frame
      const absoluteFrame = selectedItemForEditor.from + clipRelativeFrame;
      
      // Route editor scrubbing through the preview scrub path so the preview
      // can stay on its fast-scrub presentation instead of doing full seeks.
      usePlaybackStore.getState().setScrubFrame(absoluteFrame, selectedItemForEditor.id);
    },
    [selectedItemForEditor]
  );

  const handleScrubEnd = useCallback(() => {
    usePlaybackStore.getState().setPreviewFrame(null);
  }, []);

  // Handle adding a keyframe at the current frame
  const handleAddKeyframe = useCallback(
    (property: AnimatableProperty, frame: number) => {
      if (!selectedItemForEditor) return;

      const propKeyframes = keyframesByProperty[property] ?? [];
      const baseValue = getBaseKeyframeValue(selectedItemForEditor, property, canvas);
      const value = interpolatePropertyValue(propKeyframes, frame, baseValue);

      timelineActions.addKeyframe(
        selectedItemForEditor.id,
        property,
        frame,
        value
      );
    },
    [canvas, keyframesByProperty, selectedItemForEditor]
  );
  const handleAddKeyframes = useCallback(
    (entries: Array<{ property: AnimatableProperty; frame: number }>) => {
      if (!selectedItemForEditor || entries.length === 0) return;

      const payloads = entries.map(({ property, frame }) => {
        const propKeyframes = keyframesByProperty[property] ?? [];
        const baseValue = getBaseKeyframeValue(selectedItemForEditor, property, canvas);
        const value = interpolatePropertyValue(propKeyframes, frame, baseValue);

        return {
          itemId: selectedItemForEditor.id,
          property,
          frame,
          value,
        };
      });

      timelineActions.addKeyframes(payloads);
    },
    [canvas, keyframesByProperty, selectedItemForEditor]
  );
  const handleDuplicateKeyframes = useCallback(
    (entries: Array<{ ref: KeyframeRef; frame: number; value: number }>) => {
      if (!selectedItemForEditor || entries.length === 0) return;

      const payloads = entries.flatMap(({ ref, frame, value }) => {
        const sourceKeyframe = keyframesByProperty[ref.property]?.find(
          (keyframe) => keyframe.id === ref.keyframeId
        );
        if (!sourceKeyframe) {
          return [];
        }

        return [{
          itemId: selectedItemForEditor.id,
          property: ref.property,
          frame,
          value,
          easing: sourceKeyframe.easing,
          easingConfig: sourceKeyframe.easingConfig,
        }];
      });

      if (payloads.length === 0) return;

      const insertedIds = timelineActions.addKeyframes(payloads);
      const insertedRefs = insertedIds.map((keyframeId, index) => ({
        itemId: selectedItemForEditor.id,
        property: payloads[index]!.property,
        keyframeId,
      }));

      if (insertedRefs.length > 0) {
        selectKeyframes(insertedRefs);
      }
    },
    [keyframesByProperty, selectKeyframes, selectedItemForEditor]
  );

  const propertyValues = useMemo(() => {
    if (!selectedItemForEditor) return {};

    const values: Partial<Record<AnimatableProperty, number>> = {};
    for (const property of availableProperties) {
      const propKeyframes = keyframesByProperty[property] ?? [];
      const baseValue = getBaseKeyframeValue(selectedItemForEditor, property, canvas);
      values[property] = interpolatePropertyValue(propKeyframes, relativeFrame, baseValue);
    }
    return values;
  }, [availableProperties, canvas, keyframesByProperty, relativeFrame, selectedItemForEditor]);

  const handlePropertyValueCommit = useCallback(
    (
      property: AnimatableProperty,
      value: number,
      options?: { allowCreate?: boolean }
    ) => {
      if (!selectedItemForEditor) return;

      const existingKeyframe = keyframesByProperty[property]?.find(
        (keyframe) => keyframe.frame === relativeFrame
      );

      if (existingKeyframe) {
        timelineActions.updateKeyframe(
          selectedItemForEditor.id,
          property,
          existingKeyframe.id,
          { value }
        );
        selectKeyframe({
          itemId: selectedItemForEditor.id,
          property,
          keyframeId: existingKeyframe.id,
        });
        return;
      }

      if (options?.allowCreate === false) {
        return;
      }

      const keyframeId = timelineActions.addKeyframe(
        selectedItemForEditor.id,
        property,
        relativeFrame,
        value
      );

      if (keyframeId) {
        selectKeyframe({
          itemId: selectedItemForEditor.id,
          property,
          keyframeId,
        });
      }
    },
    [keyframesByProperty, relativeFrame, selectKeyframe, selectedItemForEditor]
  );

  // Handle removing keyframes
  const handleRemoveKeyframes = useCallback(
    (refs: KeyframeRef[]) => {
      if (refs.length === 0) return;
      timelineActions.removeKeyframes(refs);
    },
    []
  );

  // Handle navigation to a keyframe - convert clip-relative frame to absolute
  const handleNavigateToKeyframe = useCallback(
    (clipRelativeFrame: number) => {
      if (!selectedItemForEditor) return;
      const absoluteFrame = selectedItemForEditor.from + clipRelativeFrame;
      usePlaybackStore.getState().setCurrentFrame(absoluteFrame);
    },
    [selectedItemForEditor]
  );

  // Clamp content height when max shrinks (e.g. parent resized smaller)
  const clampedContentHeight = Math.min(contentHeight, maxContentHeight);

  // Calculate total panel height for proper flex sizing
  // When closed, show just the header; when open, show header + resize handle + content
  const panelHeight = isOpen
    ? GRAPH_PANEL_HEADER_HEIGHT + RESIZE_HANDLE_HEIGHT + clampedContentHeight
    : GRAPH_PANEL_HEADER_HEIGHT;

  const editorWidth = Math.max(0, containerWidth - 16);
  const showBezierControls = selectedEditorEasing === 'cubic-bezier';
  const showSpringControls = selectedEditorEasing === 'spring';
  const showAdvancedControls = showBezierControls || showSpringControls;
  const advancedControlsKey = useMemo(
    () => selectedEditorKeyframes
      .map(({ ref, keyframe }) => JSON.stringify({
        itemId: ref.itemId,
        property: ref.property,
        keyframeId: ref.keyframeId,
        easing: keyframe.easing,
        easingConfig: keyframe.easingConfig ?? null,
      }))
      .join('|'),
    [selectedEditorKeyframes]
  );
  const editorHeight = Math.max(
    0,
    clampedContentHeight - 16 - advancedControlsHeight - (showAdvancedControls ? 8 : 0)
  );
  // Only render the docked editor when explicitly opened from the toolbar/hotkey.
  // Selecting a clip should not surface the docked panel by itself.
  if (!isOpen) {
    return null;
  }

  const resizeHandle = (
    <div
      data-resize-handle
      className={cn(
        'h-1.5 cursor-ns-resize flex items-center justify-center',
        'bg-secondary/30 hover:bg-primary/30 transition-colors',
        isResizing && 'bg-primary/50'
      )}
      onMouseDown={handleResizeStart}
    >
      <div className="w-8 h-0.5 rounded-full bg-muted-foreground/30" />
    </div>
  );

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      onPointerEnter={(event) => {
        setIsPointerWithinEditor(true);
        const target = event.currentTarget;
        if (!target.contains(document.activeElement)) {
          target.focus({ preventScroll: true });
        }
      }}
      onPointerLeave={() => setIsPointerWithinEditor(false)}
      onFocusCapture={() => setIsFocusWithinEditor(true)}
      onBlurCapture={(event) => {
        const nextFocused = event.relatedTarget as Node | null;
        if (event.currentTarget.contains(nextFocused)) {
          return;
        }
        setIsFocusWithinEditor(false);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Delete' || event.key === 'Backspace') {
          if (selectedEditorKeyframes.length > 0) {
            event.preventDefault();
            event.stopPropagation();
            handleRemoveKeyframes(selectedEditorKeyframes.map(({ ref }) => ref));
          }
        }
      }}
      className={cn(
        'flex-shrink-0 bg-background overflow-hidden outline-none',
        placement === 'top' ? 'border-b border-border' : 'border-t border-border',
        isOpen ? 'opacity-100' : 'opacity-90',
        !isResizing && 'transition-all duration-200'
      )}
      style={{ height: panelHeight }}
    >
      {placement === 'bottom' && resizeHandle}

      {/* Header bar - always visible */}
      <div
        className="h-8 flex items-center justify-between px-3 bg-secondary/30 border-b border-border"
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            Keyframe Editor
            {selectedItemForEditor && (
              <span className="ml-2 text-foreground">
                - {selectedItemForEditor.label || selectedItemForEditor.type}
                <span className="ml-1 text-muted-foreground">
                  ({selectedItemForEditor.id.slice(0, 8)})
                </span>
              </span>
            )}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant={editorMode === 'graph' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-5 px-1.5 text-[10px]"
            onClick={(e) => {
              e.stopPropagation();
              setEditorMode('graph');
            }}
          >
            Graph
          </Button>
          <Button
            variant={editorMode === 'dopesheet' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-5 px-1.5 text-[10px]"
            onClick={(e) => {
              e.stopPropagation();
              setEditorMode('dopesheet');
            }}
          >
            Sheet
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 p-0"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
          >
            <X className="w-3 h-3" />
          </Button>
        </div>
      </div>

      {/* Keyframe editor content */}
      {isOpen && (
        <div ref={containerRef} className="p-2" style={{ height: clampedContentHeight }}>
          {showAdvancedControls && (
            <AdvancedEasingControls
              key={advancedControlsKey}
              containerRef={advancedControlsRef}
              selectedBezierPoints={showBezierControls ? selectedBezierPoints : null}
              selectedBezierPreset={selectedBezierPreset}
              hasMixedBezierConfig={hasMixedBezierConfig}
              selectedSpringParameters={showSpringControls ? selectedSpringParameters : null}
              hasMixedSpringConfig={hasMixedSpringConfig}
              applyBezier={applyBezierToSelection}
              applySpring={applySpringToSelection}
            />
          )}
          {selectedItemForEditor && containerWidth > 0 ? (
            <ErrorBoundary level="component">
              <DopesheetEditor
                itemId={selectedItemForEditor.id}
                keyframesByProperty={keyframesByProperty}
                propertyValues={propertyValues}
                selectedProperty={effectiveSelectedProperty}
                selectedKeyframeIds={selectedKeyframeIds}
                currentFrame={relativeFrame}
                globalFrame={currentFrame}
                totalFrames={selectedItemForEditor.durationInFrames}
                fps={canvas.fps}
                width={editorWidth}
                height={editorHeight}
                onKeyframeMove={handleKeyframeMove}
                onBezierHandleMove={handleBezierHandleMove}
                onSelectionChange={handleSelectionChange}
                onPropertyChange={handlePropertyChange}
                onActivePropertyChange={setSelectedProperty}
                onScrub={handleScrub}
                onScrubEnd={handleScrubEnd}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                onAddKeyframe={handleAddKeyframe}
                onAddKeyframes={handleAddKeyframes}
                onDuplicateKeyframes={handleDuplicateKeyframes}
                onPropertyValueCommit={handlePropertyValueCommit}
                onRemoveKeyframes={handleRemoveKeyframes}
                onCopyKeyframes={handleCopyKeyframes}
                onCutKeyframes={handleCutKeyframes}
                onPasteKeyframes={handlePasteKeyframes}
                hasKeyframeClipboard={Boolean(keyframeClipboard?.keyframes.length)}
                isKeyframeClipboardCut={isKeyframeClipboardCut}
                selectedInterpolation={selectedEditorEasing}
                interpolationOptions={EASING_OPTIONS}
                onInterpolationChange={handleSelectedKeyframeEasingChange}
                interpolationDisabled={selectedEditorKeyframes.length === 0}
                onNavigateToKeyframe={handleNavigateToKeyframe}
                transitionBlockedRanges={transitionBlockedRanges}
                visualizationMode={editorMode === 'graph' ? 'graph' : 'dopesheet'}
              />
            </ErrorBoundary>
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              {selectedItemForEditor ? 'Loading...' : 'Select an item to view the editor'}
            </div>
          )}
        </div>
      )}

      {placement === 'top' && resizeHandle}
    </div>
  );
});
