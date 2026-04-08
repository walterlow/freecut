/**
 * Dopesheet Editor - timeline-style keyframe editor.
 * Shows keyframes across properties as draggable diamonds on a frame grid.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { useHotkeys } from 'react-hotkeys-hook';
import {
  ClipboardPaste,
  Copy,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  LineChart,
  Lock,
  MoveHorizontal,
  MoveVertical,
  MoreHorizontal,
  Scissors,
  Timer,
  Trash2,
  X,
} from 'lucide-react';
import { cn } from '@/shared/ui/cn';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import {
  KEYFRAME_MARQUEE_THRESHOLD,
  KeyframeMarqueeOverlay,
  type KeyframeMarqueeRect,
} from '../keyframe-marquee';
import { ValueGraphEditor } from '../value-graph-editor';
import type {
  AnimatableProperty,
  BezierControlPoints,
  EasingType,
  Keyframe,
  KeyframeRef,
} from '@/types/keyframe';
import { PROPERTY_LABELS } from '@/types/keyframe';
import type { BlockedFrameRange } from '../../utils/transition-region';
import { HOTKEY_OPTIONS } from '@/config/hotkeys';
import { getFrameAxisX, getFrameFromAxisX, getVisibleKeyframeX } from './layout';
import { CompactNavigator } from './compact-navigator';
import { KeyframeTimingStrip } from './keyframe-timing-strip';
import { normalizeKeyframeNavigatorViewport } from './compact-navigator-utils';
import { getDopesheetRowControlState } from './row-controls';
import { getPropertyAccordionGroups } from './property-groups';
import { getCombinedGraphValueRange } from '../value-graph-editor/value-range-utils';
import { PROPERTY_VALUE_RANGES } from '@/features/keyframes/property-value-ranges';
import { constrainSelectedKeyframeDelta } from '@/features/keyframes/utils/frame-move-constraints';
import { useAutoKeyframeStore } from '../../stores/auto-keyframe-store';
import { clampFrame } from './frame-utils';
import {
  getCommittedHeaderFrameValues,
  planGlobalHeaderFrameCommit,
  planLocalHeaderFrameCommit,
} from './header-frame-input-actions';
import {
  buildSelectionFramePreview as buildSelectionFramePreviewState,
  commitSelectionFramePreview as commitSelectionFramePreviewState,
  duplicateSelectionFramePreview as duplicateSelectionFramePreviewState,
} from './selection-frame-actions';
import {
  buildGroupAddEntries,
  buildPropertyKeyframeRefs,
  buildRowKeyframeRefs,
  getRemovableGroupCurrentKeyframes,
  removeSelectionIds,
} from './row-action-helpers';
import { getDisplayedGroupFrameGroups as getDisplayedGroupFrameGroupsState } from './sheet-preview-frame-groups';

interface DopesheetEditorProps {
  /** Shared time viewport when split mode needs synchronized frame zoom/pan */
  frameViewport?: Viewport;
  /** Callback when the shared time viewport changes */
  onFrameViewportChange?: (viewport: Viewport) => void;
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
  /** Global timeline frame for the same playhead position */
  globalFrame?: number | null;
  /** Total duration in frames */
  totalFrames?: number;
  /** Timeline FPS used for ruler display */
  fps?: number;
  /** Width of the editor */
  width?: number;
  /** Height of the editor */
  height?: number;
  /** Callback when keyframe is moved */
  onKeyframeMove?: (ref: KeyframeRef, newFrame: number, newValue: number) => void;
  /** Callback when bezier handles are moved in graph view */
  onBezierHandleMove?: (ref: KeyframeRef, bezier: BezierControlPoints) => void;
  /** Callback when selection changes */
  onSelectionChange?: (keyframeIds: Set<string>) => void;
  /** Callback when property selection changes */
  onPropertyChange?: (property: AnimatableProperty | null) => void;
  /** Callback when a property row becomes the active interaction target */
  onActivePropertyChange?: (property: AnimatableProperty) => void;
  /** Callback when playhead is scrubbed (frame is clip-relative) */
  onScrub?: (frame: number) => void;
  /** Callback when scrubbing ends */
  onScrubEnd?: () => void;
  /** Callback when drag starts (for undo batching) */
  onDragStart?: () => void;
  /** Callback when drag ends (for undo batching) */
  onDragEnd?: () => void;
  /** Callback to add a keyframe at the current frame */
  onAddKeyframe?: (property: AnimatableProperty, frame: number) => void;
  /** Callback to add multiple keyframes in a single batch */
  onAddKeyframes?: (entries: Array<{ property: AnimatableProperty; frame: number }>) => void;
  /** Callback to duplicate keyframes to explicit target frames */
  onDuplicateKeyframes?: (entries: Array<{ ref: KeyframeRef; frame: number; value: number }>) => void;
  /** Current property values at the playhead */
  propertyValues?: Partial<Record<AnimatableProperty, number>>;
  /** Callback to commit a property value at the playhead */
  onPropertyValueCommit?: (
    property: AnimatableProperty,
    value: number,
    options?: { allowCreate?: boolean }
  ) => void;
  /** Callback to remove selected keyframes */
  onRemoveKeyframes?: (refs: KeyframeRef[]) => void;
  /** Copy selected keyframes */
  onCopyKeyframes?: () => void;
  /** Cut selected keyframes */
  onCutKeyframes?: () => void;
  /** Paste keyframes from clipboard */
  onPasteKeyframes?: () => void;
  /** Whether clipboard currently contains keyframes */
  hasKeyframeClipboard?: boolean;
  /** Whether clipboard represents a cut operation */
  isKeyframeClipboardCut?: boolean;
  /** Selected interpolation/easing for the current editor selection */
  selectedInterpolation?: EasingType;
  /** Available interpolation options */
  interpolationOptions?: ReadonlyArray<{ value: EasingType; label: string }>;
  /** Callback when the selection interpolation changes */
  onInterpolationChange?: (easing: EasingType) => void;
  /** Disable interpolation control */
  interpolationDisabled?: boolean;
  /** Callback to navigate to a keyframe */
  onNavigateToKeyframe?: (frame: number) => void;
  /** Transition-blocked frame ranges (keyframes cannot be placed here) */
  transitionBlockedRanges?: BlockedFrameRange[];
  /** Whether the editor is disabled */
  disabled?: boolean;
  /** Which visualization to render on the right side */
  visualizationMode?: 'dopesheet' | 'graph';
  /** Additional class name */
  className?: string;
}

interface Viewport {
  startFrame: number;
  endFrame: number;
}

interface KeyframeMeta {
  property: AnimatableProperty;
  keyframe: Keyframe;
}

interface DopesheetPropertyRow {
  property: AnimatableProperty;
  keyframes: Keyframe[];
  controls: ReturnType<typeof getDopesheetRowControlState>;
}

interface DopesheetPropertyGroup {
  id: string;
  label: string;
  rows: DopesheetPropertyRow[];
  frameGroups: Array<{
    frame: number;
    keyframes: Array<{ property: AnimatableProperty; keyframe: Keyframe }>;
  }>;
  currentKeyframes: Array<{ property: AnimatableProperty; keyframe: Keyframe }>;
  hasKeyframeAtCurrentFrame: boolean;
  prevKeyframe: { property: AnimatableProperty; keyframe: Keyframe } | null;
  nextKeyframe: { property: AnimatableProperty; keyframe: Keyframe } | null;
}

type RenderedSheetEntry =
  | { type: 'group'; group: DopesheetPropertyGroup; top: number }
  | { type: 'row'; row: DopesheetPropertyRow; top: number };

interface DragState {
  anchorKeyframeId: string;
  selectedKeyframeIds: string[];
  initialFrames: Map<string, number>;
  startClientX: number;
  pointerId: number;
  started: boolean;
  duplicateOnCommit: boolean;
}

type MarqueeMode = 'replace' | 'add' | 'toggle';

interface MarqueeState {
  pointerId: number;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  mode: MarqueeMode;
  baseSelection: Set<string>;
  started: boolean;
}

const PROPERTY_COLUMN_WIDTH = 248;
const MIN_VISIBLE_FRAMES = 20;
const SNAP_THRESHOLD_PX = 8;
const GROUP_HEADER_HEIGHT = 22;
const ROW_HEIGHT = 30;
const RULER_HEIGHT = 22;
const ZOOM_IN_FACTOR = 0.8;
const ZOOM_OUT_FACTOR = 1.25;
const DRAG_THRESHOLD = 2;
const MARQUEE_SCROLL_EDGE_PX = 24;
const MARQUEE_SCROLL_MAX_SPEED = 16;
const EMPTY_AUTO_KEY_ENABLED_BY_PROPERTY: Partial<Record<AnimatableProperty, boolean>> = {};
const MINI_ICON_BUTTON_CLASS = 'h-4 w-4 flex-shrink-0 rounded-sm p-0 leading-none';
const MINI_ICON_CLASS = 'h-[8px] w-[8px]';
const GRAPH_VISIBLE_PROPERTIES_STORAGE_KEY = 'timeline:keyframeGraphVisibleProperties';

function InterpolationTypeIcon({ type }: { type: EasingType }) {
  const iconProps = {
    width: 16,
    height: 16,
    viewBox: '0 0 16 16',
    fill: 'none',
  };

  const curveProps = {
    stroke: 'currentColor',
    strokeWidth: 0.88,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  const guideProps = {
    ...curveProps,
    strokeWidth: 0.66,
    opacity: 0.5,
  };

  const start = { x: 2.1, y: 11.9 };
  const end = { x: 13.9, y: 4.1 };

  const toScreenPoint = (x: number, y: number) => ({
    x: start.x + (end.x - start.x) * x,
    y: start.y - (start.y - end.y) * y,
  });

  const formatPoint = (point: { x: number; y: number }) => `${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
  const getDistance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

  const renderControlHandle = (
    anchor: { x: number; y: number },
    control: { x: number; y: number },
    key: string
  ) => {
    if (getDistance(anchor, control) < 0.9) {
      return null;
    }

    return (
      <g key={key}>
        <path d={`M${formatPoint(anchor)}L${formatPoint(control)}`} {...guideProps} />
        <circle
          cx={control.x}
          cy={control.y}
          r="0.56"
          fill="currentColor"
          stroke="none"
          opacity="0.68"
        />
      </g>
    );
  };

  const renderBezier = (x1: number, y1: number, x2: number, y2: number) => {
    const controlOne = toScreenPoint(x1, y1);
    const controlTwo = toScreenPoint(x2, y2);

    return (
      <>
        {renderControlHandle(start, controlOne, 'control-one')}
        {renderControlHandle(end, controlTwo, 'control-two')}
        <path
          d={`M${formatPoint(start)}C${formatPoint(controlOne)} ${formatPoint(controlTwo)} ${formatPoint(end)}`}
          {...curveProps}
        />
      </>
    );
  };

  const iconContent = (() => {
    if (type === 'linear') {
      return <path d={`M${formatPoint(start)}L${formatPoint(end)}`} {...curveProps} />;
    }

    if (type === 'ease-in') {
      return renderBezier(0.42, 0, 1, 1);
    }

    if (type === 'ease-out') {
      return renderBezier(0, 0, 0.58, 1);
    }

    if (type === 'ease-in-out') {
      return renderBezier(0.42, 0, 0.58, 1);
    }

    if (type === 'cubic-bezier') {
      return renderBezier(0.2, 0.1, 0.74, 0.88);
    }

    const springOne = toScreenPoint(0.24, 0.02);
    const springTwo = toScreenPoint(0.36, 0.58);
    const springMid = toScreenPoint(0.52, 0.58);
    const springThree = toScreenPoint(0.68, 0.58);
    const springFour = toScreenPoint(0.8, 1.08);
    const springSettle = toScreenPoint(0.9, 0.98);
    const springFive = toScreenPoint(0.98, 1);

    return (
      <>
        {renderControlHandle(start, springOne, 'spring-control-one')}
        {renderControlHandle(end, springFive, 'spring-control-two')}
        <path
          d={[
            `M${formatPoint(start)}`,
            `C${formatPoint(springOne)} ${formatPoint(springTwo)} ${formatPoint(springMid)}`,
            `C${formatPoint(springThree)} ${formatPoint(springFour)} ${formatPoint(springSettle)}`,
            `C${formatPoint(springSettle)} ${formatPoint(springFive)} ${formatPoint(end)}`,
          ].join(' ')}
          {...curveProps}
        />
      </>
    );
  })();

  return (
    <svg aria-hidden="true" {...iconProps}>
      {iconContent}
      <circle cx={start.x} cy={start.y} r="0.74" fill="currentColor" stroke="none" />
      <circle cx={end.x} cy={end.y} r="0.74" fill="currentColor" stroke="none" />
    </svg>
  );
}

function getNiceTickStep(frameRange: number): number {
  const rough = Math.max(1, frameRange / 10);
  const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
  const normalized = rough / magnitude;
  if (normalized <= 1) return magnitude;
  if (normalized <= 2) return 2 * magnitude;
  if (normalized <= 5) return 5 * magnitude;
  return 10 * magnitude;
}

function arePreviewFramesEqual(
  a: Record<string, number> | null,
  b: Record<string, number> | null
): boolean {
  if (a === b) return true;
  if (!a || !b) return a === b;

  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;

  for (const key of aKeys) {
    if (a[key] !== b[key]) return false;
  }

  return true;
}

function buildGroupedPropertyRows(
  rows: DopesheetPropertyRow[],
  currentFrame: number
): DopesheetPropertyGroup[] {
  const rowByProperty = new Map<AnimatableProperty, DopesheetPropertyRow>(
    rows.map((row) => [row.property, row])
  );

  return getPropertyAccordionGroups(rows.map((row) => row.property))
    .map((group) => {
      const groupedRows = group.properties.flatMap((property) => {
        const row = rowByProperty.get(property);
        return row ? [row] : [];
      });
      const keyframeEntries = groupedRows
        .flatMap((row) => row.keyframes.map((keyframe) => ({ property: row.property, keyframe })))
        .toSorted((a, b) => a.keyframe.frame - b.keyframe.frame);
      const frameGroups = keyframeEntries.reduce<Array<{
        frame: number;
        keyframes: Array<{ property: AnimatableProperty; keyframe: Keyframe }>;
      }>>((groups, entry) => {
        const lastGroup = groups.at(-1);
        if (lastGroup && lastGroup.frame === entry.keyframe.frame) {
          lastGroup.keyframes.push(entry);
        } else {
          groups.push({
            frame: entry.keyframe.frame,
            keyframes: [entry],
          });
        }
        return groups;
      }, []);
      const currentKeyframes = frameGroups.find((groupEntries) => groupEntries.frame === currentFrame)?.keyframes ?? [];

      let prevKeyframe: { property: AnimatableProperty; keyframe: Keyframe } | null = null;
      let nextKeyframe: { property: AnimatableProperty; keyframe: Keyframe } | null = null;

      for (let index = frameGroups.length - 1; index >= 0; index -= 1) {
        const frameGroup = frameGroups[index];
        if (frameGroup && frameGroup.frame < currentFrame) {
          prevKeyframe = frameGroup.keyframes[0] ?? null;
          break;
        }
      }

      for (const frameGroup of frameGroups) {
        if (frameGroup.frame > currentFrame) {
          nextKeyframe = frameGroup.keyframes[0] ?? null;
          break;
        }
      }

      return {
        id: group.id,
        label: group.label,
        rows: groupedRows,
        frameGroups,
        currentKeyframes,
        hasKeyframeAtCurrentFrame: currentKeyframes.length > 0,
        prevKeyframe,
        nextKeyframe,
      };
    })
    .filter((group) => group.rows.length > 0);
}

function getDefaultGraphVisibleProperties(
  properties: AnimatableProperty[],
  selectedProperty: AnimatableProperty | null | undefined
): Set<AnimatableProperty> {
  if (selectedProperty && properties.includes(selectedProperty)) {
    return new Set([selectedProperty]);
  }

  const firstProperty = properties[0];
  return firstProperty ? new Set([firstProperty]) : new Set();
}

function loadGraphVisibleProperties(
  itemId: string,
  properties: AnimatableProperty[],
  selectedProperty: AnimatableProperty | null | undefined
): Set<AnimatableProperty> {
  const fallback = getDefaultGraphVisibleProperties(properties, selectedProperty);

  try {
    const raw = localStorage.getItem(`${GRAPH_VISIBLE_PROPERTIES_STORAGE_KEY}:${itemId}`);
    if (!raw) {
      return fallback;
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return fallback;
    }

    const normalized = parsed.filter(
      (property): property is AnimatableProperty =>
        typeof property === 'string' && properties.includes(property as AnimatableProperty)
    );

    if (parsed.length === 0) {
      return new Set();
    }

    return normalized.length > 0 ? new Set(normalized) : fallback;
  } catch {
    return fallback;
  }
}

function saveGraphVisibleProperties(itemId: string, properties: Set<AnimatableProperty>) {
  try {
    localStorage.setItem(
      `${GRAPH_VISIBLE_PROPERTIES_STORAGE_KEY}:${itemId}`,
      JSON.stringify([...properties])
    );
  } catch {
    // ignore localStorage write errors
  }
}

function clampZoomValue(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function setPointerCaptureSafely(target: EventTarget | null, pointerId: number) {
  if (target && 'setPointerCapture' in target && typeof target.setPointerCapture === 'function') {
    target.setPointerCapture(pointerId);
  }
}

interface MiniZoomControlProps {
  icon: ReactNode;
  label: string;
  value: number;
  disabled?: boolean;
  onValueChange: (value: number) => void;
  onReset?: () => void;
}

function MiniZoomControl({
  icon,
  label,
  value,
  disabled = false,
  onValueChange,
  onReset,
}: MiniZoomControlProps) {
  const trackRef = useRef<HTMLButtonElement | null>(null);

  const updateValueFromClientX = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      if (!track) {
        return;
      }

      const rect = track.getBoundingClientRect();
      const horizontalPadding = 4;
      const usableWidth = Math.max(1, rect.width - horizontalPadding * 2);
      const nextValue = ((clientX - rect.left - horizontalPadding) / usableWidth) * 100;
      onValueChange(clampZoomValue(nextValue));
    },
    [onValueChange]
  );

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (disabled || event.button !== 0) {
        return;
      }

      event.preventDefault();
      setPointerCaptureSafely(event.currentTarget, event.pointerId);
      updateValueFromClientX(event.clientX);
    },
    [disabled, updateValueFromClientX]
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (disabled || !event.currentTarget.hasPointerCapture(event.pointerId)) {
        return;
      }

      updateValueFromClientX(event.clientX);
    },
    [disabled, updateValueFromClientX]
  );

  const handlePointerRelease = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>) => {
      if (disabled) {
        return;
      }

      if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
        event.preventDefault();
        onValueChange(clampZoomValue(value - 5));
      } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
        event.preventDefault();
        onValueChange(clampZoomValue(value + 5));
      } else if (event.key === 'Home') {
        event.preventDefault();
        onValueChange(0);
      } else if (event.key === 'End') {
        event.preventDefault();
        onValueChange(100);
      }
    },
    [disabled, onValueChange, value]
  );

  const thumbLeft = `calc(4px + ${(clampZoomValue(value) / 100).toFixed(4)} * (100% - 8px))`;

  return (
    <div className="flex items-center gap-1 rounded-md border border-border/70 bg-background/70 px-1 py-0.5">
      <span className="flex h-4 w-4 items-center justify-center text-muted-foreground">{icon}</span>
      <button
        ref={trackRef}
        type="button"
        role="slider"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(clampZoomValue(value))}
        disabled={disabled}
        title={onReset ? `${label} - double-click to reset` : label}
        className={cn(
          'relative h-5 w-16 rounded-sm outline-none transition-colors',
          disabled ? 'cursor-default opacity-50' : 'cursor-ew-resize'
        )}
        onDoubleClick={onReset}
        onKeyDown={handleKeyDown}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerRelease}
        onPointerCancel={handlePointerRelease}
      >
        <span className="pointer-events-none absolute inset-x-1 top-1/2 h-px -translate-y-1/2 bg-muted-foreground/45" />
        <span
          className="pointer-events-none absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-orange-400/80 bg-background shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
          style={{ left: thumbLeft }}
        />
      </button>
    </div>
  );
}

export const DopesheetEditor = memo(function DopesheetEditor({
  frameViewport,
  onFrameViewportChange,
  itemId,
  keyframesByProperty,
  selectedProperty = null,
  selectedKeyframeIds = new Set(),
  currentFrame = 0,
  globalFrame = null,
  totalFrames = 300,
  fps = 30,
  width = 600,
  height = 260,
  onKeyframeMove,
  onBezierHandleMove,
  onSelectionChange,
  onPropertyChange,
  onActivePropertyChange,
  onScrub,
  onScrubEnd,
  onDragStart,
  onDragEnd,
  onAddKeyframe,
  onAddKeyframes,
  onDuplicateKeyframes,
  propertyValues = {},
  onPropertyValueCommit,
  onRemoveKeyframes,
  onCopyKeyframes,
  onCutKeyframes,
  onPasteKeyframes,
  hasKeyframeClipboard = false,
  isKeyframeClipboardCut = false,
  selectedInterpolation,
  interpolationOptions = [],
  onInterpolationChange,
  interpolationDisabled = false,
  onNavigateToKeyframe,
  transitionBlockedRanges = [],
  disabled = false,
  visualizationMode = 'dopesheet',
  className,
}: DopesheetEditorProps) {
  const timelineRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const graphPaneRef = useRef<HTMLDivElement>(null);
  const keyframeButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const selectedPropertyRef = useRef<AnimatableProperty | null>(selectedProperty);
  const skipNextGraphVisibilitySaveRef = useRef(false);
  const [timelineWidth, setTimelineWidth] = useState(0);
  const [graphPaneSize, setGraphPaneSize] = useState({ width: 0, height: 0 });
  const snapEnabled = true;
  const [marqueeRect, setMarqueeRect] = useState<KeyframeMarqueeRect | null>(null);
  const [valueDrafts, setValueDrafts] = useState<Partial<Record<AnimatableProperty, string>>>({});
  const [editingValueProperty, setEditingValueProperty] = useState<AnimatableProperty | null>(null);
  const autoKeyEnabledByProperty = useAutoKeyframeStore(
    useCallback(
      (state) => state.enabledByItem[itemId] ?? EMPTY_AUTO_KEY_ENABLED_BY_PROPERTY,
      [itemId]
    )
  );
  const setAutoKeyframeEnabled = useAutoKeyframeStore((state) => state.setAutoKeyframeEnabled);
  const toggleAutoKeyframeEnabled = useAutoKeyframeStore((state) => state.toggleAutoKeyframeEnabled);
  const [localFrameInputValue, setLocalFrameInputValue] = useState('');
  const [globalFrameInputValue, setGlobalFrameInputValue] = useState('');
  const skipNextBlurCommitPropertyRef = useRef<AnimatableProperty | null>(null);
  const skipNextHeaderFrameBlurRef = useRef<'local' | 'global' | null>(null);
  const appliedDragPreviewFramesRef = useRef<Record<string, number> | null>(null);
  const [sheetPreviewFrames, setSheetPreviewFrames] = useState<Record<string, number> | null>(null);
  const [sheetPreviewDuplicateKeyframeIds, setSheetPreviewDuplicateKeyframeIds] = useState<string[] | null>(null);
  const [timingStripPreviewFrames, setTimingStripPreviewFrames] = useState<Record<string, number> | null>(null);
  const timingStripPreviewFramesRef = useRef<Record<string, number> | null>(null);
  const timingStripDraggedIdsRef = useRef<string[]>([]);
  const contentFrameMax = useMemo(() => Math.max(totalFrames, 1), [totalFrames]);
  const minViewportFrames = useMemo(
    () => Math.max(1, Math.min(MIN_VISIBLE_FRAMES, contentFrameMax)),
    [contentFrameMax]
  );

  const normalizeViewport = useCallback(
    (nextViewport: Viewport) => normalizeKeyframeNavigatorViewport(nextViewport, contentFrameMax, minViewportFrames),
    [contentFrameMax, minViewportFrames]
  );

  const buildDefaultViewport = useCallback((): Viewport => {
    return normalizeViewport({
      startFrame: 0,
      endFrame: contentFrameMax,
    });
  }, [contentFrameMax, normalizeViewport]);

  const [viewport, setViewport] = useState<Viewport>(() => frameViewport ?? buildDefaultViewport());
  const updateViewport = useCallback(
    (next: Viewport | ((prev: Viewport) => Viewport)) => {
      setViewport((prev) => {
        const resolved = normalizeViewport(typeof next === 'function' ? next(prev) : next);
        if (resolved.startFrame !== prev.startFrame || resolved.endFrame !== prev.endFrame) {
          onFrameViewportChange?.(resolved);
        }
        return resolved;
      });
    },
    [normalizeViewport, onFrameViewportChange]
  );

  useEffect(() => {
    setViewport(frameViewport ? normalizeViewport(frameViewport) : buildDefaultViewport());
  }, [buildDefaultViewport, frameViewport, normalizeViewport, selectedProperty]);

  useEffect(() => {
    if (!frameViewport) return;
    setViewport((prev) => {
      const normalizedViewport = normalizeViewport(frameViewport);
      if (
        prev.startFrame === normalizedViewport.startFrame &&
        prev.endFrame === normalizedViewport.endFrame
      ) {
        return prev;
      }
      return normalizedViewport;
    });
  }, [frameViewport, normalizeViewport]);

  useEffect(() => {
    const node = timelineRef.current;
    if (!node) {
      setTimelineWidth(0);
      return;
    }

    const updateWidth = () => {
      setTimelineWidth(node.clientWidth);
    };

    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(node);
    return () => observer.disconnect();
  }, [visualizationMode]);

  const availableProperties = useMemo(
    () => Object.keys(keyframesByProperty) as AnimatableProperty[],
    [keyframesByProperty]
  );
  const allPropertyGroups = useMemo(
    () => getPropertyAccordionGroups(availableProperties),
    [availableProperties]
  );
  const propertyGroupIdByProperty = useMemo(() => {
    const map = new Map<AnimatableProperty, string>();
    for (const group of allPropertyGroups) {
      for (const property of group.properties) {
        map.set(property, group.id);
      }
    }
    return map;
  }, [allPropertyGroups]);
  const keyframedPropertyIds = useMemo(
    () => new Set(
      availableProperties.filter((property) => (keyframesByProperty[property] ?? []).length > 0)
    ),
    [availableProperties, keyframesByProperty]
  );
  const [visibleGroups, setVisibleGroups] = useState<Record<string, boolean>>({});
  const [showKeyframedOnly, setShowKeyframedOnly] = useState(false);
  const [lockedProperties, setLockedProperties] = useState<Partial<Record<AnimatableProperty, boolean>>>({});
  const [graphRulerUnit, setGraphRulerUnit] = useState<'frames' | 'seconds'>('frames');
  const [showAllGraphHandles, setShowAllGraphHandles] = useState(false);
  const [autoZoomGraphHeight, setAutoZoomGraphHeight] = useState(true);
  const [graphVerticalZoomValue, setGraphVerticalZoomValue] = useState(0);
  const [graphVisibleProperties, setGraphVisibleProperties] = useState<Set<AnimatableProperty>>(() =>
    loadGraphVisibleProperties(itemId, availableProperties, selectedProperty)
  );

  // Restore visible curves when clip selection or available properties change
  useEffect(() => {
    skipNextGraphVisibilitySaveRef.current = true;
    setGraphVisibleProperties(
      loadGraphVisibleProperties(itemId, availableProperties, selectedPropertyRef.current)
    );
  }, [itemId, availableProperties]);

  useEffect(() => {
    selectedPropertyRef.current = selectedProperty;
  }, [selectedProperty]);

  useEffect(() => {
    if (skipNextGraphVisibilitySaveRef.current) {
      skipNextGraphVisibilitySaveRef.current = false;
      return;
    }

    saveGraphVisibleProperties(itemId, graphVisibleProperties);
  }, [graphVisibleProperties, itemId]);

  useEffect(() => {
    setGraphVerticalZoomValue(0);
  }, [itemId, autoZoomGraphHeight]);

  useEffect(() => {
    const groupIds = new Set(allPropertyGroups.map((group) => group.id));

    setVisibleGroups((prev) => {
      const next = { ...prev };
      let changed = false;

      for (const groupId of groupIds) {
        if (next[groupId] === undefined) {
          next[groupId] = true;
          changed = true;
        }
      }

      for (const groupId of Object.keys(next)) {
        if (!groupIds.has(groupId)) {
          delete next[groupId];
          changed = true;
        }
      }

      return changed ? next : prev;
    });
  }, [allPropertyGroups]);

  useEffect(() => {
    const propertyIds = new Set(availableProperties);

    setLockedProperties((prev) => {
      const next = { ...prev };
      let changed = false;

      for (const property of propertyIds) {
        if (next[property] === undefined) {
          next[property] = false;
          changed = true;
        }
      }

      for (const property of Object.keys(next) as AnimatableProperty[]) {
        if (!propertyIds.has(property)) {
          delete next[property];
          changed = true;
        }
      }

      return changed ? next : prev;
    });
  }, [availableProperties]);

  const filteredProperties = useMemo(
    () =>
      availableProperties.filter((property) => {
        const groupId = propertyGroupIdByProperty.get(property);
        const groupVisible = groupId ? (visibleGroups[groupId] ?? true) : true;
        if (!groupVisible) return false;
        if (showKeyframedOnly && !keyframedPropertyIds.has(property)) return false;
        return true;
      }),
    [availableProperties, keyframedPropertyIds, propertyGroupIdByProperty, showKeyframedOnly, visibleGroups]
  );
  const activeSelectedProperty = selectedProperty && filteredProperties.includes(selectedProperty)
    ? selectedProperty
    : null;
  const visibleProperties = filteredProperties;
  const propertyColumnProperties = filteredProperties;
  const hasPropertyFilters = showKeyframedOnly || allPropertyGroups.some((group) => visibleGroups[group.id] === false);

  const sheetRows = useMemo<DopesheetPropertyRow[]>(
    () =>
      visibleProperties.map((property) => ({
        property,
        keyframes: (keyframesByProperty[property] ?? []).toSorted((a, b) => a.frame - b.frame),
        controls: getDopesheetRowControlState(
          (keyframesByProperty[property] ?? []).toSorted((a, b) => a.frame - b.frame),
          currentFrame
        ),
      })),
    [visibleProperties, keyframesByProperty, currentFrame]
  );

  const propertyRows = useMemo<DopesheetPropertyRow[]>(
    () =>
      propertyColumnProperties.map((property) => ({
        property,
        keyframes: (keyframesByProperty[property] ?? []).toSorted((a, b) => a.frame - b.frame),
        controls: getDopesheetRowControlState(
          (keyframesByProperty[property] ?? []).toSorted((a, b) => a.frame - b.frame),
          currentFrame
        ),
      })),
    [propertyColumnProperties, keyframesByProperty, currentFrame]
  );
  const groupedSheetRows = useMemo(
    () => buildGroupedPropertyRows(sheetRows, currentFrame),
    [currentFrame, sheetRows]
  );
  const groupedPropertyRows = useMemo(
    () => buildGroupedPropertyRows(propertyRows, currentFrame),
    [currentFrame, propertyRows]
  );
  const propertyRowByProperty = useMemo(
    () => new Map(propertyRows.map((row) => [row.property, row])),
    [propertyRows]
  );
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const groupIds = new Set([
      ...groupedSheetRows.map((group) => group.id),
      ...groupedPropertyRows.map((group) => group.id),
    ]);

    setExpandedGroups((prev) => {
      const next = { ...prev };
      let changed = false;

      for (const groupId of groupIds) {
        if (next[groupId] === undefined) {
          next[groupId] = true;
          changed = true;
        }
      }

      for (const groupId of Object.keys(next)) {
        if (!groupIds.has(groupId)) {
          delete next[groupId];
          changed = true;
        }
      }

      return changed ? next : prev;
    });
  }, [groupedPropertyRows, groupedSheetRows]);

  useEffect(() => {
    if (!activeSelectedProperty) return;

    const activeGroup = [...groupedPropertyRows, ...groupedSheetRows].find((group) =>
      group.rows.some((row) => row.property === activeSelectedProperty)
    );
    if (!activeGroup) return;

    setExpandedGroups((prev) => {
      if (prev[activeGroup.id] !== false) return prev;
      return {
        ...prev,
        [activeGroup.id]: true,
      };
    });
  }, [activeSelectedProperty, groupedPropertyRows, groupedSheetRows]);

  const toggleGroup = useCallback((groupId: string) => {
    setExpandedGroups((prev) => ({
      ...prev,
      [groupId]: !(prev[groupId] ?? true),
    }));
  }, []);
  const toggleVisibleGroup = useCallback((groupId: string) => {
    setVisibleGroups((prev) => ({
      ...prev,
      [groupId]: !(prev[groupId] ?? true),
    }));
  }, []);
  const isPropertyLocked = useCallback(
    (property: AnimatableProperty) => lockedProperties[property] ?? false,
    [lockedProperties]
  );
  const toggleLockedProperty = useCallback((property: AnimatableProperty) => {
    setLockedProperties((prev) => ({
      ...prev,
      [property]: !(prev[property] ?? false),
    }));
  }, []);
  const setAllGroupsExpanded = useCallback((expanded: boolean) => {
    setExpandedGroups(
      Object.fromEntries(allPropertyGroups.map((group) => [group.id, expanded])) as Record<string, boolean>
    );
  }, [allPropertyGroups]);
  const resetParameterView = useCallback(() => {
    setShowKeyframedOnly(false);
    setVisibleGroups(
      Object.fromEntries(allPropertyGroups.map((group) => [group.id, true])) as Record<string, boolean>
    );
    setAllGroupsExpanded(true);
  }, [allPropertyGroups, setAllGroupsExpanded]);
  const togglePropertyCurve = useCallback((property: AnimatableProperty) => {
    setGraphVisibleProperties((prev) => {
      const next = new Set(prev);
      if (next.has(property)) {
        next.delete(property);
      } else {
        next.add(property);
      }
      // Set primary to this property when toggling on
      if (next.has(property)) {
        onPropertyChange?.(property);
        onActivePropertyChange?.(property);
      } else if (next.size > 0) {
        // Switch primary to first remaining visible
        const first = [...next][0]!;
        onPropertyChange?.(first);
        onActivePropertyChange?.(first);
      }
      return next;
    });
  }, [onActivePropertyChange, onPropertyChange]);

  const toggleGroupCurves = useCallback((properties: AnimatableProperty[]) => {
    if (properties.length === 0) return;
    setGraphVisibleProperties((prev) => {
      const anyVisible = properties.some((p) => prev.has(p));
      const next = new Set(prev);
      if (anyVisible) {
        // Turn all off
        for (const p of properties) next.delete(p);
        if (next.size > 0) {
          const first = [...next][0]!;
          onPropertyChange?.(first);
          onActivePropertyChange?.(first);
        }
      } else {
        // Turn all on
        for (const p of properties) next.add(p);
        onPropertyChange?.(properties[0]!);
        onActivePropertyChange?.(properties[0]!);
      }
      return next;
    });
  }, [onActivePropertyChange, onPropertyChange]);

  useEffect(() => {
    if (visualizationMode !== 'graph') return;

    const node = graphPaneRef.current;
    if (!node) return;

    const updateSize = () => {
      setGraphPaneSize({
        width: node.clientWidth,
        height: node.clientHeight,
      });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(node);
    return () => observer.disconnect();
  }, [visualizationMode, propertyRows.length]);

  const formatPropertyValue = useCallback((property: AnimatableProperty, value: number | undefined) => {
    if (value === undefined || Number.isNaN(value)) return '';
    const decimals = PROPERTY_VALUE_RANGES[property].decimals;
    return decimals === 0 ? String(Math.round(value)) : value.toFixed(decimals);
  }, []);

  useEffect(() => {
    setValueDrafts((prev) => {
      let changed = false;
      const nextDrafts = { ...prev };

      for (const property of propertyColumnProperties) {
        if (editingValueProperty === property) continue;
        const nextValue = formatPropertyValue(property, propertyValues[property]);
        if (nextDrafts[property] !== nextValue) {
          nextDrafts[property] = nextValue;
          changed = true;
        }
      }

      return changed ? nextDrafts : prev;
    });
  }, [propertyColumnProperties, propertyValues, editingValueProperty, formatPropertyValue]);
  const rowKeyframesByProperty = useMemo(() => {
    const map = new Map<AnimatableProperty, Keyframe[]>();
    for (const row of sheetRows) {
      map.set(row.property, row.keyframes);
    }
    return map;
  }, [sheetRows]);

  const keyframeMetaById = useMemo(() => {
    const map = new Map<string, KeyframeMeta>();
    for (const row of sheetRows) {
      for (const keyframe of row.keyframes) {
        map.set(keyframe.id, { property: row.property, keyframe });
      }
    }
    return map;
  }, [sheetRows]);

  const keyframeMetaByIdRef = useRef(keyframeMetaById);
  keyframeMetaByIdRef.current = keyframeMetaById;

  const selectedFrameSummary = useMemo(() => {
    const selectedFrames: number[] = [];
    for (const keyframeId of selectedKeyframeIds) {
      const meta = keyframeMetaById.get(keyframeId);
      if (meta) {
        selectedFrames.push(meta.keyframe.frame);
      }
    }

    if (selectedFrames.length === 0) {
      return {
        hasSelection: false,
        hasMixedFrames: false,
        localFrame: null as number | null,
        globalFrame: null as number | null,
      };
    }

    const firstFrame = selectedFrames[0] ?? null;
    const hasMixedFrames = selectedFrames.some((frame) => frame !== firstFrame);
    const frameOffset = globalFrame === null ? null : globalFrame - currentFrame;

    return {
      hasSelection: true,
      hasMixedFrames,
      localFrame: hasMixedFrames ? null : firstFrame,
      globalFrame:
        hasMixedFrames || firstFrame === null || frameOffset === null
          ? null
          : firstFrame + frameOffset,
    };
  }, [currentFrame, globalFrame, keyframeMetaById, selectedKeyframeIds]);
  const selectedCurveProperty = useMemo(() => {
    let property: AnimatableProperty | null = null;

    for (const keyframeId of selectedKeyframeIds) {
      const meta = keyframeMetaById.get(keyframeId);
      if (!meta) {
        continue;
      }

      if (property === null) {
        property = meta.property;
        continue;
      }

      if (property !== meta.property) {
        return null;
      }
    }

    return property;
  }, [keyframeMetaById, selectedKeyframeIds]);

  useEffect(() => {
    setLocalFrameInputValue(
      selectedFrameSummary.localFrame === null ? '' : String(selectedFrameSummary.localFrame)
    );
    setGlobalFrameInputValue(
      selectedFrameSummary.globalFrame === null ? '' : String(selectedFrameSummary.globalFrame)
    );
  }, [selectedFrameSummary.globalFrame, selectedFrameSummary.localFrame]);

  useEffect(() => {
    if (visualizationMode !== 'graph' || !selectedCurveProperty) {
      return;
    }

    if (selectedProperty !== selectedCurveProperty) {
      onPropertyChange?.(selectedCurveProperty);
    }
    onActivePropertyChange?.(selectedCurveProperty);
  }, [
    onActivePropertyChange,
    onPropertyChange,
    selectedCurveProperty,
    selectedProperty,
    visualizationMode,
  ]);

  const visibleKeyframes = useMemo(
    () =>
      sheetRows.flatMap((row) =>
        row.keyframes.map((keyframe) => ({
          property: row.property,
          keyframe,
        }))
      ),
    [sheetRows]
  );

  const frameRange = Math.max(1, viewport.endFrame - viewport.startFrame);
  const horizontalZoomRatioBase = useMemo(
    () => Math.max(1, contentFrameMax / Math.max(1, minViewportFrames)),
    [contentFrameMax, minViewportFrames]
  );
  const horizontalZoomValue = useMemo(() => {
    if (horizontalZoomRatioBase <= 1) {
      return 0;
    }

    const normalized = Math.log(contentFrameMax / Math.max(1, frameRange)) / Math.log(horizontalZoomRatioBase);
    return Math.max(0, Math.min(100, normalized * 100));
  }, [contentFrameMax, frameRange, horizontalZoomRatioBase]);
  const visibleGraphProperties = useMemo(
    () => [...graphVisibleProperties],
    [graphVisibleProperties]
  );
  const graphBaseValueRange = useMemo(
    () => getCombinedGraphValueRange(
      visibleGraphProperties.map((property) => PROPERTY_VALUE_RANGES[property] ?? null),
      visibleGraphProperties.map((property) => keyframesByProperty[property] ?? []),
      autoZoomGraphHeight
    ),
    [autoZoomGraphHeight, keyframesByProperty, visibleGraphProperties]
  );
  const graphBaseValueSpan = useMemo(
    () => Math.max(0.0001, graphBaseValueRange.max - graphBaseValueRange.min),
    [graphBaseValueRange]
  );
  const graphMinZoomValueSpan = useMemo(
    () => Math.max(graphBaseValueSpan * 0.02, 0.0001),
    [graphBaseValueSpan]
  );
  const verticalZoomRatioBase = useMemo(
    () => Math.max(1, graphBaseValueSpan / graphMinZoomValueSpan),
    [graphBaseValueSpan, graphMinZoomValueSpan]
  );
  const fallbackTimelineWidth = Math.max(width - PROPERTY_COLUMN_WIDTH, 1);
  const effectiveTimelineWidth = Math.max(
    timelineWidth || fallbackTimelineWidth,
    1
  );

  const frameToX = useCallback(
    (frame: number) => getFrameAxisX(frame, viewport, effectiveTimelineWidth),
    [viewport, effectiveTimelineWidth]
  );
  const getRenderedKeyframeX = useCallback(
    (frame: number) => getVisibleKeyframeX(frame, viewport, effectiveTimelineWidth),
    [viewport, effectiveTimelineWidth]
  );
  const setKeyframeButtonRef = useCallback((keyframeId: string, node: HTMLButtonElement | null) => {
    if (node) {
      keyframeButtonRefs.current.set(keyframeId, node);
    } else {
      keyframeButtonRefs.current.delete(keyframeId);
    }
  }, []);
  const applyDragPreviewFrames = useCallback(
    (nextPreviewFrames: Record<string, number> | null) => {
      const previousPreviewFrames = appliedDragPreviewFramesRef.current;
      if (arePreviewFramesEqual(previousPreviewFrames, nextPreviewFrames)) {
        return;
      }

      const duplicatePreviewIds = dragStateRef.current?.duplicateOnCommit && nextPreviewFrames
        ? dragStateRef.current.selectedKeyframeIds
        : null;

      flushSync(() => {
        setSheetPreviewFrames(nextPreviewFrames);
        setSheetPreviewDuplicateKeyframeIds(duplicatePreviewIds);
      });

      const keyframeIds = new Set([
        ...Object.keys(previousPreviewFrames ?? {}),
        ...Object.keys(nextPreviewFrames ?? {}),
      ]);

      if (duplicatePreviewIds) {
        appliedDragPreviewFramesRef.current = nextPreviewFrames;
        return;
      }

      for (const keyframeId of keyframeIds) {
        const button = keyframeButtonRefs.current.get(keyframeId);
        if (!button) continue;

        const previewFrame = nextPreviewFrames?.[keyframeId];
        const frame =
          previewFrame ?? keyframeMetaByIdRef.current.get(keyframeId)?.keyframe.frame;
        if (frame === undefined) continue;

        const renderedX = getRenderedKeyframeX(frame);
        if (renderedX === null) {
          button.style.visibility = 'hidden';
          continue;
        }

        button.style.left = `${renderedX}px`;
        button.style.visibility = 'visible';
      }

      appliedDragPreviewFramesRef.current = nextPreviewFrames;
    },
    [getRenderedKeyframeX]
  );
  const scheduleDragPreviewFrames = useCallback(
    (nextPreviewFrames: Record<string, number> | null) => {
      applyDragPreviewFrames(nextPreviewFrames);
    },
    [applyDragPreviewFrames]
  );
  useEffect(() => {
    timingStripPreviewFramesRef.current = timingStripPreviewFrames;
  }, [timingStripPreviewFrames]);
  useEffect(() => {
    if (visualizationMode !== 'dopesheet') {
      scheduleDragPreviewFrames(null);
      return;
    }

    scheduleDragPreviewFrames(timingStripPreviewFrames);
  }, [scheduleDragPreviewFrames, timingStripPreviewFrames, visualizationMode]);
  const renderedKeyframeXById = useMemo(() => {
    const positions = new Map<string, number>();
    for (const row of sheetRows) {
      for (const keyframe of row.keyframes) {
        const x = getRenderedKeyframeX(keyframe.frame);
        if (x !== null) {
          positions.set(keyframe.id, x);
        }
      }
    }
    return positions;
  }, [sheetRows, getRenderedKeyframeX]);
  const renderedSheetEntries = useMemo(() => {
    const entries: RenderedSheetEntry[] = [];
    let top = 0;

    for (const group of groupedSheetRows) {
      entries.push({ type: 'group', group, top });
      top += GROUP_HEADER_HEIGHT;

      if (!(expandedGroups[group.id] ?? true)) {
        continue;
      }

      for (const row of group.rows) {
        entries.push({ type: 'row', row, top });
        top += ROW_HEIGHT;
      }
    }

    return {
      entries,
      contentHeight: top,
    };
  }, [expandedGroups, groupedSheetRows]);
  const keyframePoints = useMemo(
    () =>
      renderedSheetEntries.entries.flatMap((entry) => {
        if (entry.type === 'group') {
          return entry.group.frameGroups.flatMap((frameGroup) => {
            const x = getRenderedKeyframeX(frameGroup.frame);
            if (x === null) return [];

            return frameGroup.keyframes
              .filter(({ property }) => !isPropertyLocked(property))
              .map(({ keyframe }) => ({
                keyframeId: keyframe.id,
                x,
                y: entry.top + GROUP_HEADER_HEIGHT / 2,
              }));
          });
        }

        if (isPropertyLocked(entry.row.property)) {
          return [];
        }

        return entry.row.keyframes.flatMap((keyframe) => {
          const x = renderedKeyframeXById.get(keyframe.id);
          if (x === undefined) return [];
          return [{
            keyframeId: keyframe.id,
            x,
            y: entry.top + ROW_HEIGHT / 2,
          }];
        });
      }),
    [getRenderedKeyframeX, isPropertyLocked, renderedKeyframeXById, renderedSheetEntries.entries]
  );
  const keyframePointsRef = useRef(keyframePoints);
  keyframePointsRef.current = keyframePoints;

  const xToFrame = useCallback(
    (x: number) => getFrameFromAxisX(x, viewport, effectiveTimelineWidth),
    [viewport, effectiveTimelineWidth]
  );

  const getFrameFromClientX = useCallback(
    (clientX: number) => {
      const node = timelineRef.current;
      if (!node) return currentFrame;
      const rect = node.getBoundingClientRect();
      return clampFrame(xToFrame(clientX - rect.left), totalFrames);
    },
    [xToFrame, totalFrames, currentFrame]
  );

  const getTimelineXFromClientX = useCallback(
    (clientX: number) => {
      const node = timelineRef.current;
      if (!node) return 0;
      const rect = node.getBoundingClientRect();
      return Math.max(0, Math.min(effectiveTimelineWidth, clientX - rect.left));
    },
    [effectiveTimelineWidth]
  );

  const getContentYFromClientY = useCallback(
    (clientY: number) => {
      const node = scrollAreaRef.current;
      if (!node) return 0;
      const rect = node.getBoundingClientRect();
      const y = clientY - rect.top + node.scrollTop;
      const maxY = Math.max(0, renderedSheetEntries.contentHeight);
      return Math.max(0, Math.min(maxY, y));
    },
    [renderedSheetEntries.contentHeight]
  );

  const ticks = useMemo(() => {
    const step = getNiceTickStep(frameRange);
    const first = Math.floor(viewport.startFrame / step) * step;
    const result: number[] = [];
    for (let frame = first; frame <= viewport.endFrame; frame += step) {
      if (frame >= viewport.startFrame) {
        result.push(frame);
      }
    }
    return result;
  }, [viewport.startFrame, viewport.endFrame, frameRange]);

  const propertyGridStyle = useMemo(() => {
    return { gridTemplateColumns: `${PROPERTY_COLUMN_WIDTH}px 1fr` };
  }, []);

  const selectedRefs = useMemo(() => {
    const refs: KeyframeRef[] = [];
    for (const keyframeId of selectedKeyframeIds) {
      const meta = keyframeMetaById.get(keyframeId);
      if (!meta) continue;
      if (isPropertyLocked(meta.property)) continue;
      refs.push({
        itemId,
        property: meta.property,
        keyframeId,
      });
    }
    return refs;
  }, [selectedKeyframeIds, keyframeMetaById, isPropertyLocked, itemId]);
  const selectedRefIds = useMemo(
    () => selectedRefs.map((ref) => ref.keyframeId),
    [selectedRefs]
  );

  const isCurrentFrameBlocked = useMemo(
    () => transitionBlockedRanges.some((range) => currentFrame >= range.start && currentFrame < range.end),
    [transitionBlockedRanges, currentFrame]
  );

  const snapFrameTargets = useMemo(() => {
    const targets: number[] = [0, currentFrame];
    for (const { keyframe } of visibleKeyframes) {
      if (!selectedKeyframeIds.has(keyframe.id)) {
        targets.push(keyframe.frame);
      }
    }
    return [...new Set(targets)];
  }, [visibleKeyframes, selectedKeyframeIds, currentFrame]);

  const snapThresholdFrames = useMemo(
    () => (SNAP_THRESHOLD_PX / effectiveTimelineWidth) * frameRange,
    [effectiveTimelineWidth, frameRange]
  );

  const snapFrame = useCallback(
    (frame: number) => {
      let closest = frame;
      let minDistance = Infinity;
      for (const target of snapFrameTargets) {
        const distance = Math.abs(frame - target);
        if (distance <= snapThresholdFrames && distance < minDistance) {
          minDistance = distance;
          closest = target;
        }
      }
      return closest;
    },
    [snapFrameTargets, snapThresholdFrames]
  );

  const zoomAroundFrame = useCallback(
    (centerFrame: number, factor: number) => {
      updateViewport((prev) => {
        const prevRange = Math.max(1, prev.endFrame - prev.startFrame);
        const nextRange = Math.max(minViewportFrames, Math.min(contentFrameMax, Math.round(prevRange * factor)));
        const ratio = (centerFrame - prev.startFrame) / prevRange;
        let nextStart = Math.round(centerFrame - ratio * nextRange);
        let nextEnd = nextStart + nextRange;

        if (nextStart < 0) {
          nextEnd -= nextStart;
          nextStart = 0;
        }
        if (nextEnd > contentFrameMax) {
          const overflow = nextEnd - contentFrameMax;
          nextStart = Math.max(0, nextStart - overflow);
          nextEnd = contentFrameMax;
        }
        return normalizeViewport({ startFrame: nextStart, endFrame: nextEnd });
      });
    },
    [contentFrameMax, minViewportFrames, normalizeViewport, updateViewport]
  );
  const setHorizontalZoomValue = useCallback(
    (nextValue: number) => {
      if (horizontalZoomRatioBase <= 1) {
        return;
      }

      const normalized = Math.max(0, Math.min(1, nextValue / 100));
      const nextRange = Math.max(
        minViewportFrames,
        Math.min(
          contentFrameMax,
          Math.round(contentFrameMax / Math.pow(horizontalZoomRatioBase, normalized))
        )
      );

      updateViewport((prev) => {
        const centerFrame = (prev.startFrame + prev.endFrame) / 2;
        let nextStart = Math.round(centerFrame - nextRange / 2);
        let nextEnd = nextStart + nextRange;

        if (nextStart < 0) {
          nextEnd -= nextStart;
          nextStart = 0;
        }
        if (nextEnd > contentFrameMax) {
          const overflow = nextEnd - contentFrameMax;
          nextStart = Math.max(0, nextStart - overflow);
          nextEnd = contentFrameMax;
        }

        return normalizeViewport({ startFrame: nextStart, endFrame: nextEnd });
      });
    },
    [contentFrameMax, horizontalZoomRatioBase, minViewportFrames, normalizeViewport, updateViewport]
  );

  const panFrames = useCallback(
    (deltaFrames: number) => {
      if (deltaFrames === 0) return;
      updateViewport((prev) => {
        const range = Math.max(1, prev.endFrame - prev.startFrame);
        const maxStart = Math.max(0, contentFrameMax - range);
        const nextStart = Math.max(0, Math.min(maxStart, prev.startFrame + deltaFrames));
        return normalizeViewport({
          startFrame: nextStart,
          endFrame: nextStart + range,
        });
      });
    },
    [contentFrameMax, normalizeViewport, updateViewport]
  );

  const resetViewport = useCallback(() => {
    updateViewport(buildDefaultViewport());
  }, [buildDefaultViewport, updateViewport]);

  const handleRemoveKeyframes = useCallback(() => {
    if (!onRemoveKeyframes || selectedRefs.length === 0) return;
    onRemoveKeyframes(selectedRefs);
  }, [onRemoveKeyframes, selectedRefs]);

  const buildSelectionFramePreview = useCallback(
    (selectionIds: Iterable<string>, requestedDeltaFrames: number) => {
      return buildSelectionFramePreviewState({
        selectionIds,
        requestedDeltaFrames,
        keyframeMetaById: keyframeMetaByIdRef.current,
        isPropertyLocked,
        keyframesByProperty,
        totalFrames,
        transitionBlockedRanges,
      });
    },
    [isPropertyLocked, keyframesByProperty, totalFrames, transitionBlockedRanges]
  );

  const commitSelectionFramePreview = useCallback(
    (selectionIds: Iterable<string>, previewFrames: Record<string, number> | null) => {
      return commitSelectionFramePreviewState({
        selectionIds,
        previewFrames,
        keyframeMetaById: keyframeMetaByIdRef.current,
        isPropertyLocked,
        itemId,
        onKeyframeMove,
      });
    },
    [isPropertyLocked, itemId, onKeyframeMove]
  );
  const duplicateSelectionFramePreview = useCallback(
    (selectionIds: Iterable<string>, previewFrames: Record<string, number> | null) => {
      return duplicateSelectionFramePreviewState({
        selectionIds,
        previewFrames,
        keyframeMetaById: keyframeMetaByIdRef.current,
        isPropertyLocked,
        itemId,
        onDuplicateKeyframes,
      });
    },
    [isPropertyLocked, itemId, onDuplicateKeyframes]
  );

  const canAddKeyframeForRow = useCallback(
    (row: DopesheetPropertyRow) => {
      if (disabled || !onAddKeyframe) return false;
      if (isPropertyLocked(row.property)) return false;
      if (row.controls.hasKeyframeAtCurrentFrame) return false;
      if (isCurrentFrameBlocked) return false;
      return true;
    },
    [disabled, isCurrentFrameBlocked, isPropertyLocked, onAddKeyframe]
  );

  const canClearRow = useCallback(
    (row: DopesheetPropertyRow) => {
      if (disabled || !onRemoveKeyframes) return false;
      if (isPropertyLocked(row.property)) return false;
      return row.keyframes.length > 0;
    },
    [disabled, isPropertyLocked, onRemoveKeyframes]
  );

  const resetHeaderFrameInputs = useCallback(() => {
    setLocalFrameInputValue(
      selectedFrameSummary.localFrame === null ? '' : String(selectedFrameSummary.localFrame)
    );
    setGlobalFrameInputValue(
      selectedFrameSummary.globalFrame === null ? '' : String(selectedFrameSummary.globalFrame)
    );
  }, [selectedFrameSummary.globalFrame, selectedFrameSummary.localFrame]);

  const moveSelectedKeyframesByDelta = useCallback(
    (deltaFrames: number) => {
      if (disabled || !onKeyframeMove || selectedRefIds.length === 0 || deltaFrames === 0) {
        return { didMove: false, appliedDeltaFrames: 0 };
      }

      const preview = buildSelectionFramePreview(selectedRefIds, deltaFrames);
      if (!preview.previewFrames) {
        return { didMove: false, appliedDeltaFrames: 0 };
      }

      onDragStart?.();
      const didMove = commitSelectionFramePreview(preview.movableSelectionIds, preview.previewFrames);
      onDragEnd?.();

      return {
        didMove,
        appliedDeltaFrames: preview.appliedDeltaFrames,
      };
    },
    [
      buildSelectionFramePreview,
      commitSelectionFramePreview,
      disabled,
      onDragEnd,
      onDragStart,
      onKeyframeMove,
      selectedRefIds,
    ]
  );

  const commitLocalFrameInput = useCallback(() => {
    if (!onKeyframeMove) {
      resetHeaderFrameInputs();
      return;
    }

    const plan = planLocalHeaderFrameCommit({
      inputValue: localFrameInputValue,
      selectedFrameSummary,
      totalFrames,
      transitionBlockedRanges,
    });
    if (!plan) {
      resetHeaderFrameInputs();
      return;
    }

    const moveResult = moveSelectedKeyframesByDelta(plan.targetLocalFrame - plan.initialLocalFrame);
    const committedValues = getCommittedHeaderFrameValues(plan, moveResult);

    setLocalFrameInputValue(committedValues.localInputValue);
    if (committedValues.globalInputValue !== null) {
      setGlobalFrameInputValue(committedValues.globalInputValue);
    }

    if (!moveResult.didMove) {
      return;
    }

    onNavigateToKeyframe?.(committedValues.finalLocalFrame);
  }, [
    localFrameInputValue,
    moveSelectedKeyframesByDelta,
    onKeyframeMove,
    onNavigateToKeyframe,
    resetHeaderFrameInputs,
    selectedFrameSummary,
    totalFrames,
    transitionBlockedRanges,
  ]);

  const commitGlobalFrameInput = useCallback(() => {
    if (!onKeyframeMove) {
      resetHeaderFrameInputs();
      return;
    }

    const plan = planGlobalHeaderFrameCommit({
      inputValue: globalFrameInputValue,
      selectedFrameSummary,
      currentFrame,
      globalFrame,
      totalFrames,
      transitionBlockedRanges,
    });
    if (!plan) {
      resetHeaderFrameInputs();
      return;
    }

    const moveResult = moveSelectedKeyframesByDelta(plan.targetLocalFrame - plan.initialLocalFrame);
    const committedValues = getCommittedHeaderFrameValues(plan, moveResult);

    setLocalFrameInputValue(committedValues.localInputValue);
    if (committedValues.globalInputValue !== null) {
      setGlobalFrameInputValue(committedValues.globalInputValue);
    }

    if (!moveResult.didMove) {
      return;
    }

    onNavigateToKeyframe?.(committedValues.finalLocalFrame);
  }, [
    currentFrame,
    globalFrame,
    globalFrameInputValue,
    moveSelectedKeyframesByDelta,
    onKeyframeMove,
    onNavigateToKeyframe,
    resetHeaderFrameInputs,
    selectedFrameSummary,
    totalFrames,
    transitionBlockedRanges,
  ]);

  const handleHeaderFrameInputKeyDown = useCallback(
    (
      event: React.KeyboardEvent<HTMLInputElement>,
      input: 'local' | 'global',
      commit: () => void
    ) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        skipNextHeaderFrameBlurRef.current = input;
        event.currentTarget.blur();
        commit();
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        resetHeaderFrameInputs();
        skipNextHeaderFrameBlurRef.current = input;
        event.currentTarget.blur();
      }
    },
    [resetHeaderFrameInputs]
  );

  const activateProperty = useCallback((property: AnimatableProperty) => {
    if (visualizationMode === 'graph') {
      onPropertyChange?.(property);
    }
    onActivePropertyChange?.(property);
  }, [onActivePropertyChange, onPropertyChange, visualizationMode]);

  const removeKeyframesForRows = useCallback(
    (rows: DopesheetPropertyRow[]) => {
      if (!onRemoveKeyframes) return;

      const refs = buildRowKeyframeRefs(itemId, rows);

      if (refs.length === 0) return;

      onRemoveKeyframes(refs);

      if (onSelectionChange) {
        onSelectionChange(removeSelectionIds(selectedKeyframeIds, refs.map((ref) => ref.keyframeId)));
      }
    },
    [itemId, onRemoveKeyframes, onSelectionChange, selectedKeyframeIds]
  );

  const handleClearProperty = useCallback(
    (property: AnimatableProperty) => {
      const row = propertyRowByProperty.get(property);
      if (!row || !canClearRow(row)) return;

      activateProperty(property);
      removeKeyframesForRows([row]);
    },
    [activateProperty, canClearRow, propertyRowByProperty, removeKeyframesForRows]
  );

  const handleAddGroupKeyframes = useCallback(
    (group: DopesheetPropertyGroup) => {
      if (disabled || (!onAddKeyframe && !onAddKeyframes)) return;

      const entries = buildGroupAddEntries(group.rows, currentFrame, canAddKeyframeForRow);

      if (entries.length === 0) {
        return;
      }

      if (onAddKeyframes) {
        onAddKeyframes(entries);
        return;
      }

      for (const entry of entries) {
        onAddKeyframe?.(entry.property, entry.frame);
      }
    },
    [canAddKeyframeForRow, currentFrame, disabled, onAddKeyframe, onAddKeyframes]
  );

  const handleClearGroup = useCallback(
    (group: DopesheetPropertyGroup) => {
      removeKeyframesForRows(group.rows.filter((row) => canClearRow(row)));
    },
    [canClearRow, removeKeyframesForRows]
  );

  const handleGroupToggleKeyframes = useCallback(
    (group: DopesheetPropertyGroup) => {
      const removableCurrentKeyframes = getRemovableGroupCurrentKeyframes(
        group.currentKeyframes,
        isPropertyLocked
      );

      if (removableCurrentKeyframes.length > 0) {
        if (!onRemoveKeyframes) return;

        const refs = removableCurrentKeyframes.map(({ property, keyframe }) => ({
          itemId,
          property,
          keyframeId: keyframe.id,
        }));
        onRemoveKeyframes(refs);

        if (onSelectionChange) {
          onSelectionChange(
            removeSelectionIds(
              selectedKeyframeIds,
              removableCurrentKeyframes.map(({ keyframe }) => keyframe.id)
            )
          );
        }
        return;
      }

      handleAddGroupKeyframes(group);
    },
    [handleAddGroupKeyframes, isPropertyLocked, itemId, onRemoveKeyframes, onSelectionChange, selectedKeyframeIds]
  );

  const handleRowNavigate = useCallback(
    (property: AnimatableProperty, keyframe: Keyframe | null) => {
      if (!keyframe || !onNavigateToKeyframe) return;
      activateProperty(property);
      onNavigateToKeyframe(keyframe.frame);
      onSelectionChange?.(new Set([keyframe.id]));
      selectionAnchorByPropertyRef.current.set(property, keyframe.id);
    },
    [activateProperty, onNavigateToKeyframe, onSelectionChange]
  );

  const handleRowToggleKeyframe = useCallback(
    (property: AnimatableProperty, currentKeyframes: Keyframe[]) => {
      if (isPropertyLocked(property)) return;
      activateProperty(property);
      if (currentKeyframes.length > 0) {
        if (!onRemoveKeyframes) return;
        const refs = buildPropertyKeyframeRefs(itemId, property, currentKeyframes);
        onRemoveKeyframes(refs);
        if (onSelectionChange) {
          onSelectionChange(
            removeSelectionIds(selectedKeyframeIds, currentKeyframes.map((keyframe) => keyframe.id))
          );
        }
        return;
      }

      if (isCurrentFrameBlocked || !onAddKeyframe) return;
      onAddKeyframe(property, currentFrame);
    },
    [
      currentFrame,
      isCurrentFrameBlocked,
      itemId,
      onAddKeyframe,
      onRemoveKeyframes,
      onSelectionChange,
      selectedKeyframeIds,
      activateProperty,
      isPropertyLocked,
    ]
  );

  const handleRowValueChange = useCallback((property: AnimatableProperty, value: string) => {
    setValueDrafts((prev) => ({ ...prev, [property]: value }));
  }, []);

  const handleRowAutoKeyToggle = useCallback((property: AnimatableProperty) => {
    if (isPropertyLocked(property)) return;
    activateProperty(property);
    toggleAutoKeyframeEnabled(itemId, property);
  }, [activateProperty, isPropertyLocked, itemId, toggleAutoKeyframeEnabled]);

  const handleGroupAutoKeyToggle = useCallback(
    (group: DopesheetPropertyGroup) => {
      const eligibleRows = group.rows.filter((row) => !isPropertyLocked(row.property));
      if (eligibleRows.length === 0) return;

      const enableAll = !eligibleRows.every((row) => autoKeyEnabledByProperty[row.property] ?? false);
      for (const row of eligibleRows) {
        setAutoKeyframeEnabled(itemId, row.property, enableAll);
      }
    },
    [autoKeyEnabledByProperty, isPropertyLocked, itemId, setAutoKeyframeEnabled]
  );

  const handleRowValueCommit = useCallback(
    (property: AnimatableProperty, options?: { allowCreate?: boolean }) => {
      if (isPropertyLocked(property)) return;
      const range = PROPERTY_VALUE_RANGES[property];
      const parsed = Number(valueDrafts[property]);

      if (!Number.isFinite(parsed)) {
        setValueDrafts((prev) => ({
          ...prev,
          [property]: formatPropertyValue(property, propertyValues[property]),
        }));
        return;
      }

      const clampedValue = Math.max(range.min, Math.min(range.max, parsed));
      onPropertyValueCommit?.(property, clampedValue, options);
      setValueDrafts((prev) => ({
        ...prev,
        [property]: formatPropertyValue(property, clampedValue),
      }));
    },
    [formatPropertyValue, isPropertyLocked, onPropertyValueCommit, propertyValues, valueDrafts]
  );

  const nudgeSelectedKeyframes = useCallback(
    (deltaFrames: number) => {
      moveSelectedKeyframesByDelta(deltaFrames);
    },
    [moveSelectedKeyframesByDelta]
  );

  useHotkeys(
    'delete,backspace',
    (event) => {
      event.preventDefault();
      if (selectedRefs.length > 0) {
        onRemoveKeyframes?.(selectedRefs);
      }
    },
    { ...HOTKEY_OPTIONS, enabled: !disabled && selectedRefs.length > 0 },
    [disabled, selectedRefs, onRemoveKeyframes]
  );

  useHotkeys(
    'left',
    (event) => {
      event.preventDefault();
      nudgeSelectedKeyframes(-1);
    },
    { ...HOTKEY_OPTIONS, enabled: !disabled && selectedRefs.length > 0 },
    [disabled, selectedRefs.length, nudgeSelectedKeyframes]
  );

  useHotkeys(
    'right',
    (event) => {
      event.preventDefault();
      nudgeSelectedKeyframes(1);
    },
    { ...HOTKEY_OPTIONS, enabled: !disabled && selectedRefs.length > 0 },
    [disabled, selectedRefs.length, nudgeSelectedKeyframes]
  );

  useHotkeys(
    'shift+left',
    (event) => {
      event.preventDefault();
      nudgeSelectedKeyframes(-10);
    },
    { ...HOTKEY_OPTIONS, enabled: !disabled && selectedRefs.length > 0 },
    [disabled, selectedRefs.length, nudgeSelectedKeyframes]
  );

  useHotkeys(
    'shift+right',
    (event) => {
      event.preventDefault();
      nudgeSelectedKeyframes(10);
    },
    { ...HOTKEY_OPTIONS, enabled: !disabled && selectedRefs.length > 0 },
    [disabled, selectedRefs.length, nudgeSelectedKeyframes]
  );

  const dragStateRef = useRef<DragState | null>(null);
  const marqueeStateRef = useRef<MarqueeState | null>(null);
  const marqueeJustEndedRef = useRef(false);
  const selectionAnchorByPropertyRef = useRef(new Map<AnimatableProperty, string>());

  const getMarqueeModeFromPointerEvent = useCallback(
    (event: Pick<React.PointerEvent, 'shiftKey' | 'ctrlKey' | 'metaKey'>): MarqueeMode =>
      event.shiftKey
        ? 'add'
        : (event.ctrlKey || event.metaKey)
          ? 'toggle'
          : 'replace',
    []
  );

  const beginMarqueeSelection = useCallback(
    (
      pointerId: number,
      clientX: number,
      clientY: number,
      mode: MarqueeMode,
      baseSelection: Set<string>
    ) => {
      const startX = getTimelineXFromClientX(clientX);
      const startY = getContentYFromClientY(clientY);
      marqueeStateRef.current = {
        pointerId,
        startX,
        startY,
        currentX: startX,
        currentY: startY,
        mode,
        baseSelection,
        started: false,
      };
    },
    [getContentYFromClientY, getTimelineXFromClientX]
  );

  const handleKeyframePointerDown = useCallback(
    (
      property: AnimatableProperty,
      keyframeId: string,
      event: React.PointerEvent<HTMLButtonElement>
    ) => {
      if (disabled) return;
      if (isPropertyLocked(property)) return;
      event.preventDefault();
      event.stopPropagation();
      onActivePropertyChange?.(property);

      if (event.shiftKey && !event.ctrlKey && !event.metaKey) {
        const propertyKeyframes = rowKeyframesByProperty.get(property) ?? [];
        const clickedIndex = propertyKeyframes.findIndex((keyframe) => keyframe.id === keyframeId);
        const anchorId = selectionAnchorByPropertyRef.current.get(property);
        const anchorIndex = anchorId
          ? propertyKeyframes.findIndex((keyframe) => keyframe.id === anchorId)
          : -1;

        const nextSelection = new Set(selectedKeyframeIds);
        if (clickedIndex >= 0 && anchorIndex >= 0) {
          const start = Math.min(clickedIndex, anchorIndex);
          const end = Math.max(clickedIndex, anchorIndex);
          for (let i = start; i <= end; i++) {
            const keyframe = propertyKeyframes[i];
            if (keyframe) nextSelection.add(keyframe.id);
          }
        } else {
          nextSelection.add(keyframeId);
        }
        onSelectionChange?.(nextSelection);
        selectionAnchorByPropertyRef.current.set(property, keyframeId);
        return;
      }

      if (event.ctrlKey || event.metaKey) {
        const nextSelection = new Set(selectedKeyframeIds);
        if (nextSelection.has(keyframeId)) {
          nextSelection.delete(keyframeId);
        } else {
          nextSelection.add(keyframeId);
        }
        onSelectionChange?.(nextSelection);
        selectionAnchorByPropertyRef.current.set(property, keyframeId);
        return;
      }

      const baseSelection = selectedKeyframeIds.has(keyframeId)
        ? new Set(selectedKeyframeIds)
        : new Set([keyframeId]);

      if (!selectedKeyframeIds.has(keyframeId)) {
        onSelectionChange?.(baseSelection);
      }
      selectionAnchorByPropertyRef.current.set(property, keyframeId);

      const selectedIdsForDrag = baseSelection.has(keyframeId) && baseSelection.size > 1
        ? Array.from(baseSelection)
        : [keyframeId];

      const initialFrames = new Map<string, number>();
      for (const id of selectedIdsForDrag) {
        const meta = keyframeMetaByIdRef.current.get(id);
        if (!meta) continue;
        initialFrames.set(id, meta.keyframe.frame);
      }

      dragStateRef.current = {
        anchorKeyframeId: keyframeId,
        selectedKeyframeIds: selectedIdsForDrag,
        initialFrames,
        startClientX: event.clientX,
        pointerId: event.pointerId,
        started: false,
        duplicateOnCommit: !!onDuplicateKeyframes && event.altKey,
      };
      scheduleDragPreviewFrames(null);

      setPointerCaptureSafely(event.currentTarget, event.pointerId);
    },
    [
      disabled,
      isPropertyLocked,
      onDuplicateKeyframes,
      onActivePropertyChange,
      rowKeyframesByProperty,
      scheduleDragPreviewFrames,
      selectedKeyframeIds,
      onSelectionChange,
    ]
  );
  const handleGroupKeyframePointerDown = useCallback(
    (
      frameGroup: DopesheetPropertyGroup['frameGroups'][number],
      event: React.PointerEvent<HTMLButtonElement>
    ) => {
      if (disabled) return;
      if (event.button !== 0) return;

      const movableEntries = frameGroup.keyframes.filter(({ property }) => !isPropertyLocked(property));
      if (movableEntries.length === 0) return;

      event.preventDefault();
      event.stopPropagation();

      const keyframeIds = movableEntries.map(({ keyframe }) => keyframe.id);
      const anchorEntry = movableEntries[0];
      if (!anchorEntry) return;

      if (event.shiftKey && !event.ctrlKey && !event.metaKey) {
        onSelectionChange?.(new Set([...selectedKeyframeIds, ...keyframeIds]));
        return;
      }

      if (event.ctrlKey || event.metaKey) {
        const nextSelection = new Set(selectedKeyframeIds);
        for (const keyframeId of keyframeIds) {
          if (nextSelection.has(keyframeId)) {
            nextSelection.delete(keyframeId);
          } else {
            nextSelection.add(keyframeId);
          }
        }
        onSelectionChange?.(nextSelection);
        return;
      }

      const allSelected = keyframeIds.every((keyframeId) => selectedKeyframeIds.has(keyframeId));
      const baseSelection = allSelected
        ? new Set(selectedKeyframeIds)
        : new Set(keyframeIds);
      if (!allSelected) {
        onSelectionChange?.(baseSelection);
      }
      onActivePropertyChange?.(anchorEntry.property);
      for (const { property, keyframe } of movableEntries) {
        selectionAnchorByPropertyRef.current.set(property, keyframe.id);
      }

      const selectedIdsForDrag = allSelected && baseSelection.size > keyframeIds.length
        ? Array.from(baseSelection)
        : keyframeIds;
      const initialFrames = new Map<string, number>();
      for (const keyframeId of selectedIdsForDrag) {
        const meta = keyframeMetaByIdRef.current.get(keyframeId);
        if (!meta) continue;
        initialFrames.set(keyframeId, meta.keyframe.frame);
      }

      dragStateRef.current = {
        anchorKeyframeId: anchorEntry.keyframe.id,
        selectedKeyframeIds: selectedIdsForDrag,
        initialFrames,
        startClientX: event.clientX,
        pointerId: event.pointerId,
        started: false,
        duplicateOnCommit: !!onDuplicateKeyframes && event.altKey,
      };
      scheduleDragPreviewFrames(null);

      setPointerCaptureSafely(event.currentTarget, event.pointerId);
    },
    [
      disabled,
      isPropertyLocked,
      onDuplicateKeyframes,
      onActivePropertyChange,
      onSelectionChange,
      scheduleDragPreviewFrames,
      selectedKeyframeIds,
    ]
  );
  const getDisplayedGroupFrameGroups = useCallback(
    (group: DopesheetPropertyGroup) => {
      return getDisplayedGroupFrameGroupsState({
        group,
        sheetPreviewFrames,
        sheetPreviewDuplicateKeyframeIds,
      });
    },
    [sheetPreviewDuplicateKeyframeIds, sheetPreviewFrames]
  );

  const updateSelectionFromMarquee = useCallback(
    (state: MarqueeState) => {
      const minX = Math.min(state.startX, state.currentX);
      const maxX = Math.max(state.startX, state.currentX);
      const minY = Math.min(state.startY, state.currentY);
      const maxY = Math.max(state.startY, state.currentY);

      const hitIds = new Set<string>();
      for (const point of keyframePointsRef.current) {
        if (point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY) {
          hitIds.add(point.keyframeId);
        }
      }

      let nextSelection = new Set<string>();
      if (state.mode === 'replace') {
        nextSelection = hitIds;
      } else if (state.mode === 'add') {
        nextSelection = new Set([...state.baseSelection, ...hitIds]);
      } else {
        nextSelection = new Set(state.baseSelection);
        for (const keyframeId of hitIds) {
          if (nextSelection.has(keyframeId)) {
            nextSelection.delete(keyframeId);
          } else {
            nextSelection.add(keyframeId);
          }
        }
      }

      onSelectionChange?.(nextSelection);
      setMarqueeRect({
        x: minX,
        y: minY,
        width: Math.max(1, maxX - minX),
        height: Math.max(1, maxY - minY),
      });
    },
    [onSelectionChange]
  );

  const handleRowPointerDown = useCallback(
    (property: AnimatableProperty, event: React.PointerEvent<HTMLDivElement>) => {
      if (disabled) return;
      if (isPropertyLocked(property)) return;
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      onActivePropertyChange?.(property);

      beginMarqueeSelection(
        event.pointerId,
        event.clientX,
        event.clientY,
        getMarqueeModeFromPointerEvent(event),
        new Set(selectedKeyframeIds)
      );

      setPointerCaptureSafely(event.currentTarget, event.pointerId);
    },
    [beginMarqueeSelection, disabled, getMarqueeModeFromPointerEvent, isPropertyLocked, onActivePropertyChange, selectedKeyframeIds]
  );

  const handleTimelineBackgroundPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (disabled) return;
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();

      beginMarqueeSelection(
        event.pointerId,
        event.clientX,
        event.clientY,
        getMarqueeModeFromPointerEvent(event),
        new Set(selectedKeyframeIds)
      );

      setPointerCaptureSafely(event.currentTarget, event.pointerId);
    },
    [beginMarqueeSelection, disabled, getMarqueeModeFromPointerEvent, selectedKeyframeIds]
  );

  useEffect(() => {
    if (!onKeyframeMove && !onDuplicateKeyframes) return;

    const handlePointerMove = (event: PointerEvent) => {
      if (disabled) return;
      const dragState = dragStateRef.current;
      if (!dragState) return;
      if (dragState.pointerId !== event.pointerId) return;

      const deltaX = event.clientX - dragState.startClientX;
      if (!dragState.started && Math.abs(deltaX) > DRAG_THRESHOLD) {
        dragState.started = true;
        if (!dragState.duplicateOnCommit) {
          onDragStart?.();
        }
      }

      if (!dragState.started) return;

      const deltaFramesRaw = (deltaX / effectiveTimelineWidth) * frameRange;
      let deltaFrames = Math.round(deltaFramesRaw);

      if (snapEnabled && !event.ctrlKey && !event.metaKey) {
        const anchorInitialFrame = dragState.initialFrames.get(dragState.anchorKeyframeId);
        if (anchorInitialFrame !== undefined) {
          const anchorCandidate = clampFrame(anchorInitialFrame + deltaFrames, totalFrames);
          const snappedAnchor = snapFrame(anchorCandidate);
          deltaFrames += snappedAnchor - anchorCandidate;
        }
      }

      const preview = buildSelectionFramePreview(dragState.selectedKeyframeIds, deltaFrames);
      scheduleDragPreviewFrames(preview.previewFrames);
    };

    const handlePointerUp = (event: PointerEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState || dragState.pointerId !== event.pointerId) return;

      if (dragState.started) {
        const previewFrames = appliedDragPreviewFramesRef.current;
        if (dragState.duplicateOnCommit) {
          duplicateSelectionFramePreview(dragState.selectedKeyframeIds, previewFrames);
        } else {
          commitSelectionFramePreview(dragState.selectedKeyframeIds, previewFrames);
          onDragEnd?.();
        }
      }
      dragStateRef.current = null;
      scheduleDragPreviewFrames(null);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [
      disabled,
      buildSelectionFramePreview,
      commitSelectionFramePreview,
      duplicateSelectionFramePreview,
      onKeyframeMove,
      onDuplicateKeyframes,
      onDragStart,
      onDragEnd,
      effectiveTimelineWidth,
      frameRange,
      totalFrames,
      snapEnabled,
      snapFrame,
      scheduleDragPreviewFrames,
  ]);

  const scrubPointerIdRef = useRef<number | null>(null);
  const lastScrubbedFrameRef = useRef<number | null>(null);
  const handleRulerPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (disabled) return;
      event.preventDefault();
      scrubPointerIdRef.current = event.pointerId;
      setPointerCaptureSafely(event.currentTarget, event.pointerId);
      const frame = getFrameFromClientX(event.clientX);
      lastScrubbedFrameRef.current = frame;
      onScrub?.(frame);
    },
    [disabled, onScrub, getFrameFromClientX]
  );

  const handleRulerPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (disabled) return;
      if (scrubPointerIdRef.current !== event.pointerId) return;
      const frame = getFrameFromClientX(event.clientX);
      if (frame === lastScrubbedFrameRef.current) return;
      lastScrubbedFrameRef.current = frame;
      onScrub?.(frame);
    },
    [disabled, onScrub, getFrameFromClientX]
  );

  const handleRulerPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (scrubPointerIdRef.current !== event.pointerId) return;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // ignore pointer capture errors
    }
    scrubPointerIdRef.current = null;
    lastScrubbedFrameRef.current = null;
    onScrubEnd?.();
  }, [onScrubEnd]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const marqueeState = marqueeStateRef.current;
      if (!marqueeState || marqueeState.pointerId !== event.pointerId) return;

      const scrollNode = scrollAreaRef.current;
      if (scrollNode) {
        const rect = scrollNode.getBoundingClientRect();
        const topEdge = rect.top + MARQUEE_SCROLL_EDGE_PX;
        const bottomEdge = rect.bottom - MARQUEE_SCROLL_EDGE_PX;
        let scrollDelta = 0;

        if (event.clientY < topEdge) {
          const intensity = Math.min(1, (topEdge - event.clientY) / MARQUEE_SCROLL_EDGE_PX);
          scrollDelta = -Math.max(1, Math.round(intensity * MARQUEE_SCROLL_MAX_SPEED));
        } else if (event.clientY > bottomEdge) {
          const intensity = Math.min(1, (event.clientY - bottomEdge) / MARQUEE_SCROLL_EDGE_PX);
          scrollDelta = Math.max(1, Math.round(intensity * MARQUEE_SCROLL_MAX_SPEED));
        }

        if (scrollDelta !== 0) {
          const maxScrollTop = Math.max(0, scrollNode.scrollHeight - scrollNode.clientHeight);
          scrollNode.scrollTop = Math.max(
            0,
            Math.min(maxScrollTop, scrollNode.scrollTop + scrollDelta)
          );
        }
      }

      const x = getTimelineXFromClientX(event.clientX);
      const y = getContentYFromClientY(event.clientY);
      const movedEnough =
        Math.abs(x - marqueeState.startX) > KEYFRAME_MARQUEE_THRESHOLD ||
        Math.abs(y - marqueeState.startY) > KEYFRAME_MARQUEE_THRESHOLD;
      if (!marqueeState.started && movedEnough) {
        marqueeState.started = true;
      }
      if (!marqueeState.started) return;

      marqueeState.currentX = x;
      marqueeState.currentY = y;
      updateSelectionFromMarquee(marqueeState);
    };

    const handlePointerUp = (event: PointerEvent) => {
      const marqueeState = marqueeStateRef.current;
      if (!marqueeState || marqueeState.pointerId !== event.pointerId) return;
      if (marqueeState.started) {
        marqueeJustEndedRef.current = true;
        setTimeout(() => {
          marqueeJustEndedRef.current = false;
        }, 100);
      } else if (marqueeState.mode === 'replace') {
        onSelectionChange?.(new Set());
      }
      marqueeStateRef.current = null;
      setMarqueeRect(null);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [getTimelineXFromClientX, getContentYFromClientY, updateSelectionFromMarquee, onSelectionChange]);

  const handleWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      if (disabled) return;
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        const pivotFrame = getFrameFromClientX(event.clientX);
        if (event.deltaY > 0) {
          zoomAroundFrame(pivotFrame, ZOOM_OUT_FACTOR);
        } else {
          zoomAroundFrame(pivotFrame, ZOOM_IN_FACTOR);
        }
        return;
      }

      const deltaFrames = Math.round((event.deltaY / effectiveTimelineWidth) * frameRange);
      panFrames(deltaFrames);
    },
    [
      disabled,
      getFrameFromClientX,
      zoomAroundFrame,
      panFrames,
      effectiveTimelineWidth,
      viewport.endFrame,
      viewport.startFrame,
    ]
  );

  const playheadLeft = Math.max(0, Math.min(effectiveTimelineWidth - 1, frameToX(currentFrame)));
  const graphDisplayProperty = useMemo(
    () => {
      if (graphVisibleProperties.size === 0) return null;
      if (activeSelectedProperty && graphVisibleProperties.has(activeSelectedProperty)) {
        return activeSelectedProperty;
      }
      return null;
    },
    [activeSelectedProperty, graphVisibleProperties]
  );
  const graphDisplayPropertyLocked = graphDisplayProperty
    ? isPropertyLocked(graphDisplayProperty)
    : false;
  const focusGraphPane = useCallback(() => {
    graphPaneRef.current?.focus();
  }, []);
  const handleGraphPaneKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (disabled || graphDisplayPropertyLocked || selectedRefs.length === 0) {
        return;
      }

      const hasModifier = event.ctrlKey || event.metaKey || event.altKey;

      if (!hasModifier && (event.key === 'Delete' || event.key === 'Backspace')) {
        if (!onRemoveKeyframes) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        onRemoveKeyframes(selectedRefs);
        return;
      }

      if (!hasModifier && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        event.preventDefault();
        event.stopPropagation();
        nudgeSelectedKeyframes(
          event.key === 'ArrowLeft'
            ? (event.shiftKey ? -10 : -1)
            : (event.shiftKey ? 10 : 1)
        );
      }
    },
    [
      disabled,
      graphDisplayPropertyLocked,
      nudgeSelectedKeyframes,
      onRemoveKeyframes,
      selectedRefs,
    ]
  );
  const timingStripMarkers = useMemo(
    () => {
      if (visualizationMode === 'graph') {
        if (!activeSelectedProperty) {
          return [];
        }

        return (keyframesByProperty[activeSelectedProperty] ?? []).map((keyframe) => ({
          id: keyframe.id,
          frame: keyframe.frame,
          selected: selectedKeyframeIds.has(keyframe.id),
          draggable: !!onKeyframeMove && selectedRefIds.includes(keyframe.id),
        }));
      }

      return visibleKeyframes
        .filter(({ keyframe }) => selectedKeyframeIds.has(keyframe.id))
        .map(({ property, keyframe }) => ({
          id: keyframe.id,
          frame: keyframe.frame,
          selected: true,
          draggable: !!onKeyframeMove && !isPropertyLocked(property),
        }));
    },
    [activeSelectedProperty, isPropertyLocked, keyframesByProperty, onKeyframeMove, selectedKeyframeIds, selectedRefIds, visibleKeyframes, visualizationMode]
  );
  const constrainGraphFrameDelta = useCallback(
    (deltaFrames: number, draggedKeyframeIds: string[]) =>
      constrainSelectedKeyframeDelta({
        keyframesByProperty,
        selectedKeyframeIds: new Set(draggedKeyframeIds),
        totalFrames,
        deltaFrames,
      }),
    [keyframesByProperty, totalFrames]
  );
  const handleTimingStripSelectionChange = useCallback(
    (selectedIds: Set<string>) => {
      onSelectionChange?.(selectedIds);
    },
    [onSelectionChange]
  );
  const handleTimingStripSlideStart = useCallback((selectedIds: string[]) => {
    if (disabled || !onKeyframeMove || selectedIds.length === 0) {
      return;
    }

    timingStripDraggedIdsRef.current = selectedIds;
    onDragStart?.();
  }, [disabled, onDragStart, onKeyframeMove]);
  const handleTimingStripSlideChange = useCallback(
    (deltaFrames: number, selectedIds: string[]) => {
      timingStripDraggedIdsRef.current = selectedIds;
      const preview = buildSelectionFramePreview(selectedIds, deltaFrames);
      setTimingStripPreviewFrames(preview.previewFrames);
    },
    [buildSelectionFramePreview]
  );
  const handleTimingStripSlideEnd = useCallback((selectedIds: string[]) => {
    const dragIds = selectedIds.length > 0 ? selectedIds : timingStripDraggedIdsRef.current;
    commitSelectionFramePreview(dragIds, timingStripPreviewFramesRef.current);
    timingStripDraggedIdsRef.current = [];
    setTimingStripPreviewFrames(null);
    onDragEnd?.();
  }, [commitSelectionFramePreview, onDragEnd]);
  const formatRulerTick = useCallback(
    (frame: number): string => {
      if (graphRulerUnit === 'frames' || !fps || fps <= 0) {
        return String(frame);
      }
      const seconds = frame / fps;
      if (seconds >= 60) {
        const minutes = Math.floor(seconds / 60);
        const remainder = seconds - minutes * 60;
        return `${minutes}:${remainder.toFixed(1).padStart(4, '0')}`;
      }
      return `${seconds.toFixed(seconds < 10 ? 2 : 1)}s`;
    },
    [graphRulerUnit, fps]
  );

  const rulerTickElements = useMemo(
    () =>
      ticks.map((frame) => (
        <div
          key={frame}
          className="absolute inset-y-0 border-l border-border/60"
          style={{ left: frameToX(frame) }}
        >
          <span className="absolute top-0.5 left-1 text-[10px] text-muted-foreground">
            {formatRulerTick(frame)}
          </span>
        </div>
      )),
    [ticks, frameToX, formatRulerTick]
  );
  const renderPropertyRowContent = useCallback(
    (row: DopesheetPropertyRow, options?: { indented?: boolean }) => {
      const rowLocked = isPropertyLocked(row.property);
      const curveVisible = graphVisibleProperties.has(row.property);

        return (
          <div
            className={cn(
            'h-full px-1 flex items-center gap-px bg-muted/8',
              options?.indented && 'pl-3',
              row.controls.hasKeyframeAtCurrentFrame && 'bg-primary/10',
              visualizationMode === 'graph' && graphVisibleProperties.has(row.property) && 'bg-accent/40',
            visualizationMode === 'graph' && !rowLocked && 'cursor-pointer',
            rowLocked && 'opacity-70'
          )}
          onClick={visualizationMode === 'graph' && !rowLocked ? () => activateProperty(row.property) : undefined}
        >
          <div className="flex items-center gap-px self-stretch">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(
                MINI_ICON_BUTTON_CLASS,
                'self-center text-muted-foreground hover:text-foreground',
                curveVisible ? 'text-orange-500 hover:text-orange-400' : 'opacity-30 hover:opacity-60'
              )}
              onClick={(event) => {
                event.stopPropagation();
                togglePropertyCurve(row.property);
              }}
              title={`Show ${PROPERTY_LABELS[row.property]} curve`}
              aria-label={`Show ${PROPERTY_LABELS[row.property]} curve`}
              aria-pressed={curveVisible}
            >
              <LineChart className={MINI_ICON_CLASS} />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(
                MINI_ICON_BUTTON_CLASS,
                'self-center text-muted-foreground hover:text-foreground',
                rowLocked ? 'text-red-400 hover:text-red-300' : 'opacity-30 hover:opacity-60'
              )}
              onClick={(event) => {
                event.stopPropagation();
                toggleLockedProperty(row.property);
              }}
              title={rowLocked ? `Unlock ${PROPERTY_LABELS[row.property]} row` : `Lock ${PROPERTY_LABELS[row.property]} row`}
              aria-label={rowLocked ? `Unlock ${PROPERTY_LABELS[row.property]} row` : `Lock ${PROPERTY_LABELS[row.property]} row`}
              aria-pressed={rowLocked}
            >
              <Lock className={MINI_ICON_CLASS} />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(
                MINI_ICON_BUTTON_CLASS,
                'self-center text-muted-foreground hover:text-foreground',
                autoKeyEnabledByProperty[row.property] &&
                  'bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground'
              )}
              onClick={() => handleRowAutoKeyToggle(row.property)}
              disabled={disabled || rowLocked || !onPropertyValueCommit}
              title={
                autoKeyEnabledByProperty[row.property]
                  ? `Auto-key enabled for ${PROPERTY_LABELS[row.property]}`
                  : `Enable auto-key for ${PROPERTY_LABELS[row.property]}`
              }
              aria-label={
                autoKeyEnabledByProperty[row.property]
                  ? `Auto-key enabled for ${PROPERTY_LABELS[row.property]}`
                  : `Enable auto-key for ${PROPERTY_LABELS[row.property]}`
              }
              aria-pressed={autoKeyEnabledByProperty[row.property] ?? false}
            >
              <Timer className={MINI_ICON_CLASS} />
            </Button>
          </div>
          <div className="flex h-full min-w-0 flex-1 items-center truncate pl-[10px] pr-1 text-[9px] font-medium leading-none text-foreground/90">
            {PROPERTY_LABELS[row.property]}
          </div>
          <div className="ml-auto flex items-center gap-0">
          <Input
            type="number"
            value={valueDrafts[row.property] ?? ''}
            onChange={(event) => handleRowValueChange(row.property, event.target.value)}
            onFocus={() => {
              activateProperty(row.property);
              setEditingValueProperty(row.property);
            }}
            onBlur={() => {
              if (skipNextBlurCommitPropertyRef.current === row.property) {
                skipNextBlurCommitPropertyRef.current = null;
              } else {
                handleRowValueCommit(row.property, {
                  allowCreate: autoKeyEnabledByProperty[row.property] ?? false,
                });
              }
              setEditingValueProperty((current) => (current === row.property ? null : current));
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                skipNextBlurCommitPropertyRef.current = row.property;
                handleRowValueCommit(row.property, { allowCreate: true });
                setEditingValueProperty((current) => (current === row.property ? null : current));
                event.currentTarget.blur();
              } else if (event.key === 'Escape') {
                event.preventDefault();
                skipNextBlurCommitPropertyRef.current = row.property;
                setValueDrafts((prev) => ({
                  ...prev,
                  [row.property]: formatPropertyValue(row.property, propertyValues[row.property]),
                }));
                setEditingValueProperty((current) => (current === row.property ? null : current));
                event.currentTarget.blur();
              }
            }}
            step={PROPERTY_VALUE_RANGES[row.property].decimals === 0 ? 1 : 0.1}
            min={PROPERTY_VALUE_RANGES[row.property].min}
            max={PROPERTY_VALUE_RANGES[row.property].max}
            inputMode="decimal"
            className="h-[18px] w-[44px] border-border/70 bg-background/85 px-1 py-0 text-right text-[9px] leading-none tabular-nums md:text-[9px]"
            disabled={
              disabled ||
              rowLocked ||
              !onPropertyValueCommit ||
              (!row.controls.hasKeyframeAtCurrentFrame && isCurrentFrameBlocked)
            }
            aria-label={`${PROPERTY_LABELS[row.property]} value at playhead`}
          />
          <div className="flex items-center gap-0 rounded-sm border border-border/70 bg-background/85 px-0">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-4 w-4 p-0 text-muted-foreground hover:text-foreground"
              onClick={() => handleRowNavigate(row.property, row.controls.prevKeyframe)}
              disabled={disabled || row.controls.prevKeyframe === null || !onNavigateToKeyframe}
              title={`Previous ${PROPERTY_LABELS[row.property]} keyframe`}
              aria-label={`Previous ${PROPERTY_LABELS[row.property]} keyframe`}
            >
              <ChevronLeft className="h-[9px] w-[9px]" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(
                'h-4 w-4 p-0 hover:bg-transparent',
                row.controls.hasKeyframeAtCurrentFrame
                  ? 'text-primary hover:text-primary'
                  : 'text-muted-foreground hover:text-foreground',
                isCurrentFrameBlocked &&
                  !row.controls.hasKeyframeAtCurrentFrame &&
                  'opacity-40 cursor-not-allowed'
              )}
              onClick={() => handleRowToggleKeyframe(row.property, row.controls.currentKeyframes)}
              disabled={
                disabled ||
                rowLocked ||
                (!row.controls.hasKeyframeAtCurrentFrame &&
                  (isCurrentFrameBlocked || !onAddKeyframe))
              }
              title={
                row.controls.hasKeyframeAtCurrentFrame
                  ? `Remove ${PROPERTY_LABELS[row.property]} keyframe at playhead`
                  : `Toggle ${PROPERTY_LABELS[row.property]} keyframe at playhead`
              }
              aria-label={
                row.controls.hasKeyframeAtCurrentFrame
                  ? `Remove ${PROPERTY_LABELS[row.property]} keyframe at playhead`
                  : `Toggle ${PROPERTY_LABELS[row.property]} keyframe at playhead`
              }
            >
              <span
                className={cn(
                  'block h-[7px] w-[7px] rotate-45 border transition-colors',
                  row.controls.hasKeyframeAtCurrentFrame
                    ? 'border-primary bg-primary'
                    : 'border-current bg-transparent'
                )}
              />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-4 w-4 p-0 text-muted-foreground hover:text-foreground"
              onClick={() => handleRowNavigate(row.property, row.controls.nextKeyframe)}
              disabled={disabled || row.controls.nextKeyframe === null || !onNavigateToKeyframe}
              title={`Next ${PROPERTY_LABELS[row.property]} keyframe`}
              aria-label={`Next ${PROPERTY_LABELS[row.property]} keyframe`}
            >
              <ChevronRight className="h-[9px] w-[9px]" />
            </Button>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-4 w-4 p-0 text-muted-foreground hover:text-foreground"
            onClick={(event) => {
              event.stopPropagation();
              handleClearProperty(row.property);
            }}
            disabled={!canClearRow(row)}
            title={`Clear ${PROPERTY_LABELS[row.property]} keyframes`}
            aria-label={`Clear ${PROPERTY_LABELS[row.property]} keyframes`}
          >
            <X className="h-[9px] w-[9px]" />
          </Button>
        </div>
        </div>
      );
    },
    [
      activateProperty,
      canClearRow,
      autoKeyEnabledByProperty,
      disabled,
      formatPropertyValue,
      graphDisplayProperty,
      graphVisibleProperties,
      handleClearProperty,
      handleRowAutoKeyToggle,
      handleRowNavigate,
      handleRowToggleKeyframe,
      handleRowValueChange,
      handleRowValueCommit,
      isPropertyLocked,
      isCurrentFrameBlocked,
      onAddKeyframe,
      onNavigateToKeyframe,
      onPropertyValueCommit,
      propertyValues,
      togglePropertyCurve,
      toggleLockedProperty,
      valueDrafts,
      visualizationMode,
    ]
  );
  const renderGroupHeaderContent = useCallback(
    (group: DopesheetPropertyGroup) => {
      const groupProperties = group.rows.map((row) => row.property);
      const curveVisible = groupProperties.some((p) => graphVisibleProperties.has(p));
      const allRowsLocked = group.rows.length > 0 && group.rows.every((row) => isPropertyLocked(row.property));
      const unlockedRows = group.rows.filter((row) => !isPropertyLocked(row.property));
      const groupAutoKeyEnabled = unlockedRows.length > 0
        && unlockedRows.every((row) => autoKeyEnabledByProperty[row.property] ?? false);
      const canAddAny = group.rows.some((row) => canAddKeyframeForRow(row));
      const canClearAny = group.rows.some((row) => canClearRow(row));
      const isOpen = expandedGroups[group.id] ?? true;
      const unlockedCurrentKeyframes = group.currentKeyframes.filter(
        ({ property }) => !isPropertyLocked(property)
      );
      const hasUnlockedCurrentKeyframes = unlockedCurrentKeyframes.length > 0;
      const canToggleCurrentFrame = hasUnlockedCurrentKeyframes
        ? !!onRemoveKeyframes
        : canAddAny;

      return (
        <div className="flex h-full items-center gap-px bg-muted/40 pl-3 pr-0.5">
          <div className="flex items-center gap-px self-stretch">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(
                MINI_ICON_BUTTON_CLASS,
                'self-center text-muted-foreground hover:text-foreground',
                curveVisible ? 'text-orange-500 hover:text-orange-400' : 'opacity-30 hover:opacity-60'
              )}
              onClick={(event) => {
                event.stopPropagation();
                toggleGroupCurves(groupProperties);
              }}
              disabled={groupProperties.length === 0}
              title={`Show all ${group.label} curves`}
              aria-label={`Show all ${group.label} curves`}
              aria-pressed={curveVisible}
            >
              <LineChart className={MINI_ICON_CLASS} />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(
                MINI_ICON_BUTTON_CLASS,
                'self-center text-muted-foreground hover:text-foreground',
                allRowsLocked ? 'text-red-400 hover:text-red-300' : 'opacity-30 hover:opacity-60'
              )}
              onClick={(event) => {
                event.stopPropagation();
                setLockedProperties((prev) => ({
                  ...prev,
                  ...Object.fromEntries(groupProperties.map((property) => [property, !allRowsLocked])),
                }));
              }}
              disabled={groupProperties.length === 0}
              title={allRowsLocked ? `Unlock ${group.label} rows` : `Lock ${group.label} rows`}
              aria-label={allRowsLocked ? `Unlock ${group.label} rows` : `Lock ${group.label} rows`}
              aria-pressed={allRowsLocked}
            >
              <Lock className={MINI_ICON_CLASS} />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(
                MINI_ICON_BUTTON_CLASS,
                'self-center text-muted-foreground hover:text-foreground',
                groupAutoKeyEnabled && 'bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground'
              )}
              onClick={(event) => {
                event.stopPropagation();
                handleGroupAutoKeyToggle(group);
              }}
              disabled={disabled || unlockedRows.length === 0 || !onPropertyValueCommit}
              title={groupAutoKeyEnabled ? `Auto-key enabled for ${group.label}` : `Enable auto-key for ${group.label}`}
              aria-label={groupAutoKeyEnabled ? `Auto-key enabled for ${group.label}` : `Enable auto-key for ${group.label}`}
              aria-pressed={groupAutoKeyEnabled}
            >
              <Timer className={MINI_ICON_CLASS} />
            </Button>
          </div>
          <button
            type="button"
            className="group flex min-w-0 flex-1 items-center gap-px rounded-sm px-0 text-left leading-none transition-colors hover:bg-background/40"
            onClick={() => toggleGroup(group.id)}
            aria-expanded={isOpen}
            aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${group.label}`}
          >
            {isOpen ? (
              <ChevronDown className={cn(MINI_ICON_CLASS, 'flex-shrink-0 text-muted-foreground transition-colors group-hover:text-foreground/80')} />
            ) : (
              <ChevronRight className={cn(MINI_ICON_CLASS, 'flex-shrink-0 text-muted-foreground transition-colors group-hover:text-foreground/80')} />
            )}
            <span className="truncate pl-px text-[9px] font-medium uppercase leading-none tracking-[0.06em] text-foreground/90">
              {group.label}
            </span>
          </button>
          <div className="ml-auto flex items-center gap-0 rounded-sm border border-border/70 bg-background/90 px-px shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(MINI_ICON_BUTTON_CLASS, 'text-muted-foreground hover:text-foreground')}
              onClick={(event) => {
                event.stopPropagation();
                handleRowNavigate(group.prevKeyframe?.property ?? group.rows[0]?.property ?? 'x', group.prevKeyframe?.keyframe ?? null);
              }}
              disabled={disabled || group.prevKeyframe === null || !onNavigateToKeyframe}
              title={`Previous ${group.label} keyframe`}
              aria-label={`Previous ${group.label} keyframe`}
            >
              <ChevronLeft className={MINI_ICON_CLASS} />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(
                MINI_ICON_BUTTON_CLASS,
                'hover:bg-transparent',
                group.hasKeyframeAtCurrentFrame
                  ? 'text-primary hover:text-primary'
                  : 'text-muted-foreground hover:text-foreground',
                isCurrentFrameBlocked && !group.hasKeyframeAtCurrentFrame && 'opacity-40 cursor-not-allowed'
              )}
              onClick={(event) => {
                event.stopPropagation();
                handleGroupToggleKeyframes(group);
              }}
              disabled={!canToggleCurrentFrame}
              title={
                hasUnlockedCurrentKeyframes
                  ? `Remove ${group.label} keyframes at playhead`
                  : `Toggle ${group.label} keyframes at playhead`
              }
              aria-label={
                hasUnlockedCurrentKeyframes
                  ? `Remove ${group.label} keyframes at playhead`
                  : `Toggle ${group.label} keyframes at playhead`
              }
            >
              <span
                className={cn(
                  'block h-[7px] w-[7px] rotate-45 border transition-colors',
                  hasUnlockedCurrentKeyframes
                    ? 'border-primary bg-primary'
                    : 'border-current bg-transparent'
                )}
              />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(MINI_ICON_BUTTON_CLASS, 'text-muted-foreground hover:text-foreground')}
              onClick={(event) => {
                event.stopPropagation();
                handleRowNavigate(group.nextKeyframe?.property ?? group.rows[0]?.property ?? 'x', group.nextKeyframe?.keyframe ?? null);
              }}
              disabled={disabled || group.nextKeyframe === null || !onNavigateToKeyframe}
              title={`Next ${group.label} keyframe`}
              aria-label={`Next ${group.label} keyframe`}
            >
              <ChevronRight className={MINI_ICON_CLASS} />
            </Button>
            <div className="mx-[1px] h-3 w-px bg-border/80" />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(MINI_ICON_BUTTON_CLASS, 'text-muted-foreground hover:text-foreground')}
              onClick={(event) => {
                event.stopPropagation();
                handleClearGroup(group);
              }}
              disabled={!canClearAny}
              title={`Clear all ${group.label} keyframes`}
              aria-label={`Clear all ${group.label} keyframes`}
            >
              <X className={MINI_ICON_CLASS} />
            </Button>
          </div>
        </div>
      );
    },
    [
      autoKeyEnabledByProperty,
      canAddKeyframeForRow,
      canClearRow,
      disabled,
      expandedGroups,
      handleClearGroup,
      handleGroupAutoKeyToggle,
      handleGroupToggleKeyframes,
      handleRowNavigate,
      graphDisplayProperty,
      graphVisibleProperties,
      isPropertyLocked,
      isCurrentFrameBlocked,
      onRemoveKeyframes,
      onNavigateToKeyframe,
      onPropertyValueCommit,
      toggleGroupCurves,
      togglePropertyCurve,
      toggleGroup,
    ]
  );
  const rowElements = useMemo(
    () =>
      renderedSheetEntries.entries.map((entry) => {
        if (entry.type === 'group') {
          return (
            <div
              key={entry.group.id}
              className="grid w-full border-b border-border/60"
              style={{ ...propertyGridStyle, height: GROUP_HEADER_HEIGHT }}
            >
              {renderGroupHeaderContent(entry.group)}
              <div
                className="relative border-l border-border/60 bg-muted/20 overflow-hidden"
                onPointerDown={handleTimelineBackgroundPointerDown}
              >
                {ticks.map((frame) => (
                  <div
                    key={`${entry.group.id}-tick-${frame}`}
                    className="absolute inset-y-0 border-l border-border/30 pointer-events-none"
                    style={{ left: frameToX(frame) }}
                  />
                ))}

                {(sheetPreviewDuplicateKeyframeIds ? entry.group.frameGroups : getDisplayedGroupFrameGroups(entry.group)).map((frameGroup) => {
                  const renderedX = getRenderedKeyframeX(frameGroup.frame);
                  if (renderedX === null) {
                    return null;
                  }

                  const movableEntries = frameGroup.keyframes.filter(({ property }) => !isPropertyLocked(property));
                  const isSelected = movableEntries.some(({ keyframe }) => selectedKeyframeIds.has(keyframe.id));

                  return (
                    <button
                      key={`${entry.group.id}-${frameGroup.frame}`}
                      type="button"
                      data-testid={`group-keyframe-${entry.group.id}-${frameGroup.frame}`}
                      className={cn(
                        'group absolute z-10 flex h-3 w-3 -ml-1.5 -mt-1.5 items-center justify-center',
                        movableEntries.length === 0 && 'cursor-not-allowed opacity-50'
                      )}
                      style={{
                        left: renderedX,
                        top: '50%',
                      }}
                      disabled={movableEntries.length === 0 || disabled}
                      onPointerDown={(event) =>
                        handleGroupKeyframePointerDown(frameGroup, event)
                      }
                      onClick={(event) => event.stopPropagation()}
                      aria-label={`${entry.group.label} keyframe at frame ${frameGroup.frame}`}
                    >
                      <span
                        className={cn(
                          'pointer-events-none block h-2 w-2 rotate-45 border transition-colors',
                          isSelected
                            ? 'border-orange-50 bg-orange-500 shadow-[0_0_0_1px_rgba(249,115,22,0.45)]'
                            : 'border-transparent bg-orange-500 group-hover:bg-orange-400'
                        )}
                      />
                    </button>
                  );
                })}
                {sheetPreviewDuplicateKeyframeIds && getDisplayedGroupFrameGroups(entry.group).map((frameGroup) => {
                  const renderedX = getRenderedKeyframeX(frameGroup.frame);
                  if (renderedX === null) {
                    return null;
                  }

                  return (
                    <div
                      key={`preview-${entry.group.id}-${frameGroup.frame}`}
                      className="absolute z-20 flex h-3 w-3 -ml-1.5 -mt-1.5 items-center justify-center pointer-events-none"
                      style={{ left: renderedX, top: '50%' }}
                    >
                      <span className="block h-2 w-2 rotate-45 border border-primary/70 bg-primary/70 shadow-[0_0_0_1px_rgba(59,130,246,0.35)]" />
                    </div>
                  );
                })}
              </div>
            </div>
          );
        }

        const { row } = entry;
        const rowLocked = isPropertyLocked(row.property);
        return (
          <div key={row.property} className="grid border-b border-border/60" style={{ ...propertyGridStyle, height: ROW_HEIGHT }}>
            {renderPropertyRowContent(row, { indented: true })}
            <div
              className="relative border-l border-border/60 overflow-hidden"
              onPointerDown={(event) => handleRowPointerDown(row.property, event)}
            >
              {ticks.map((frame) => (
                <div
                  key={frame}
                  className="absolute inset-y-0 border-l border-border/30 pointer-events-none"
                  style={{ left: frameToX(frame) }}
                />
              ))}

              {transitionBlockedRanges.map((range, index) => (
                <div
                  key={`${row.property}-${index}-${range.start}-${range.end}`}
                  className="absolute inset-y-0 bg-destructive/10 border-x border-destructive/20 pointer-events-none"
                  style={{
                    left: frameToX(range.start),
                    width: frameToX(range.end) - frameToX(range.start),
                  }}
                />
              ))}

              {row.keyframes.map((keyframe) => {
                const renderedX = renderedKeyframeXById.get(keyframe.id);
                if (renderedX === undefined) return null;
                const selected = selectedKeyframeIds.has(keyframe.id);
                return (
                  <button
                    key={keyframe.id}
                    ref={(node) => setKeyframeButtonRef(keyframe.id, node)}
                    type="button"
                    data-testid={`row-keyframe-${row.property}-${keyframe.id}`}
                    className={cn(
                      'group absolute z-10 flex h-3 w-3 -ml-1.5 -mt-1.5 items-center justify-center',
                      rowLocked && 'cursor-not-allowed opacity-50'
                    )}
                    style={{
                      left: renderedX,
                      top: '50%',
                    }}
                    disabled={rowLocked || disabled}
                    onPointerDown={(event) =>
                      handleKeyframePointerDown(row.property, keyframe.id, event)
                    }
                    onClick={(event) => event.stopPropagation()}
                    aria-label={`Keyframe at frame ${keyframe.frame}`}
                  >
                    <span
                      className={cn(
                        'pointer-events-none block h-2 w-2 rotate-45 border transition-colors',
                        selected
                          ? 'border-orange-50 bg-orange-500 shadow-[0_0_0_1px_rgba(249,115,22,0.45)]'
                          : 'border-transparent bg-orange-500 group-hover:bg-orange-400'
                      )}
                    />
                    </button>
                  );
                })}
              {sheetPreviewDuplicateKeyframeIds?.flatMap((keyframeId) => {
                const meta = keyframeMetaByIdRef.current.get(keyframeId);
                if (!meta || meta.property !== row.property) {
                  return [];
                }

                const previewFrame = sheetPreviewFrames?.[keyframeId];
                if (previewFrame === undefined) {
                  return [];
                }

                const renderedX = getRenderedKeyframeX(previewFrame);
                if (renderedX === null) {
                  return [];
                }

                return [
                  <div
                    key={`preview-${row.property}-${keyframeId}`}
                    className="absolute z-20 flex h-3 w-3 -ml-1.5 -mt-1.5 items-center justify-center pointer-events-none"
                    style={{ left: renderedX, top: '50%' }}
                  >
                    <span className="block h-2 w-2 rotate-45 border border-primary/70 bg-primary/70 shadow-[0_0_0_1px_rgba(59,130,246,0.35)]" />
                  </div>,
                ];
              })}
            </div>
          </div>
        );
      }),
    [
      renderedSheetEntries.entries,
      propertyGridStyle,
      handleRowPointerDown,
      handleTimelineBackgroundPointerDown,
      handleGroupKeyframePointerDown,
      getDisplayedGroupFrameGroups,
      renderGroupHeaderContent,
      renderPropertyRowContent,
      getRenderedKeyframeX,
      isPropertyLocked,
      ticks,
      frameToX,
      transitionBlockedRanges,
      selectedKeyframeIds,
      sheetPreviewDuplicateKeyframeIds,
      sheetPreviewFrames,
      handleKeyframePointerDown,
      setKeyframeButtonRef,
    ]
  );
  const propertyColumnElements = useMemo(
    () =>
      groupedPropertyRows.flatMap((group) => {
        const groupOpen = expandedGroups[group.id] ?? true;
        const elements: React.ReactNode[] = [
          <div
            key={group.id}
            className="h-6 border-b border-border/60"
          >
            {renderGroupHeaderContent(group)}
          </div>,
        ];

        if (!groupOpen) {
          return elements;
        }

        return elements.concat(
          group.rows.map((row) => (
            <div key={row.property} className="border-b border-border/60" style={{ height: ROW_HEIGHT }}>
              {renderPropertyRowContent(row, { indented: true })}
            </div>
          ))
        );
      }),
    [expandedGroups, groupedPropertyRows, renderGroupHeaderContent, renderPropertyRowContent]
  );
  const emptyStateMessage = hasPropertyFilters
    ? 'No parameters match the current view'
    : 'No keyframes to display';

  return (
    <div className={cn('flex h-full flex-col gap-0.5 overflow-hidden', className)} style={{ height, width }}>
      <div className="flex items-center justify-between px-2 flex-shrink-0 min-h-7">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground">Parameters</span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  disabled={disabled || availableProperties.length === 0}
                  aria-label="Parameter display options"
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-[240px]">
                <DropdownMenuItem
                  onSelect={(event) => {
                    event.preventDefault();
                    setShowKeyframedOnly((prev) => !prev);
                  }}
                >
                  <Check className={cn('h-3.5 w-3.5', !showKeyframedOnly && 'opacity-0')} />
                  Display Parameters with Keyframes
                </DropdownMenuItem>
                {allPropertyGroups.length > 0 && <DropdownMenuSeparator />}
                {allPropertyGroups.map((group) => {
                  const isVisible = visibleGroups[group.id] ?? true;
                  return (
                    <DropdownMenuItem
                      key={group.id}
                      onSelect={(event) => {
                        event.preventDefault();
                        toggleVisibleGroup(group.id);
                      }}
                    >
                      <Check className={cn('h-3.5 w-3.5', !isVisible && 'opacity-0')} />
                      {`Display ${group.label} Parameters`}
                    </DropdownMenuItem>
                  );
                })}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setAllGroupsExpanded(true)}>
                  Expand All Parameters
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setAllGroupsExpanded(false)}>
                  Collapse All Parameters
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={resetParameterView}>
                  Reset Parameter View
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {hasPropertyFilters && (
            <span className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
              Filtered
            </span>
          )}

          {visualizationMode === 'graph' && graphDisplayProperty && (
            <span className="text-xs text-muted-foreground">
              Graph: {PROPERTY_LABELS[graphDisplayProperty]}
            </span>
          )}

          <span className="text-xs text-muted-foreground">
            {visibleKeyframes.length} keyframe{visibleKeyframes.length !== 1 ? 's' : ''}
          </span>

          <div className="flex items-center gap-1">
            <div className="flex items-center gap-0.5">
              <span className="text-[10px] text-muted-foreground">Local</span>
              <Input
                type="number"
                value={localFrameInputValue}
                onChange={(event) => setLocalFrameInputValue(event.target.value)}
                placeholder="-"
                onBlur={() => {
                  if (skipNextHeaderFrameBlurRef.current === 'local') {
                    skipNextHeaderFrameBlurRef.current = null;
                    return;
                  }
                  commitLocalFrameInput();
                }}
                onKeyDown={(event) =>
                  handleHeaderFrameInputKeyDown(event, 'local', commitLocalFrameInput)
                }
                aria-label="Local frame"
                className="h-5 w-12 px-1 text-center text-[10px] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                min={0}
                max={Math.max(totalFrames - 1, 0)}
                disabled={
                  disabled ||
                  !onKeyframeMove ||
                  !selectedFrameSummary.hasSelection ||
                  selectedFrameSummary.hasMixedFrames
                }
              />
            </div>
            {globalFrame !== null && (
              <div className="flex items-center gap-0.5">
                <span className="text-[10px] text-muted-foreground">Global</span>
                <Input
                  type="number"
                  value={globalFrameInputValue}
                  onChange={(event) => setGlobalFrameInputValue(event.target.value)}
                  placeholder="-"
                  onBlur={() => {
                    if (skipNextHeaderFrameBlurRef.current === 'global') {
                      skipNextHeaderFrameBlurRef.current = null;
                      return;
                    }
                    commitGlobalFrameInput();
                  }}
                  onKeyDown={(event) =>
                    handleHeaderFrameInputKeyDown(event, 'global', commitGlobalFrameInput)
                  }
                  aria-label="Global frame"
                  className="h-5 w-14 px-1 text-center text-[10px] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  disabled={
                    disabled ||
                    !onKeyframeMove ||
                    !selectedFrameSummary.hasSelection ||
                    selectedFrameSummary.hasMixedFrames
                  }
                />
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {visualizationMode === 'graph' && interpolationOptions.length > 0 && (
            <div
              className="flex items-center gap-0.5 rounded-md border border-border/80 bg-muted/20 px-0.5 py-0.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]"
              aria-label="Interpolation controls"
            >
              {interpolationOptions.map((option) => {
                const isActive = selectedInterpolation === option.value;
                return (
                  <Button
                    key={option.value}
                    variant="ghost"
                    size="sm"
                    className={cn(
                      'h-6 w-6 p-0 text-muted-foreground/80 hover:bg-background/60 hover:text-foreground',
                      isActive && 'bg-background text-foreground shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)] hover:bg-background hover:text-foreground'
                    )}
                    onClick={() => onInterpolationChange?.(option.value)}
                    disabled={disabled || interpolationDisabled || !onInterpolationChange}
                    title={option.label}
                    aria-label={`Set interpolation to ${option.label}`}
                    aria-pressed={isActive}
                  >
                    <InterpolationTypeIcon type={option.value} />
                  </Button>
                );
              })}
            </div>
          )}
          {(onCopyKeyframes || onCutKeyframes || onPasteKeyframes) && (
            <div className="flex items-center gap-0.5 rounded-md border border-border/70 bg-background/85 px-0.5 py-0.5">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={onCopyKeyframes}
                disabled={disabled || selectedRefs.length === 0 || !onCopyKeyframes}
                title="Copy selected keyframes"
                aria-label="Copy selected keyframes"
              >
                <Copy className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={onCutKeyframes}
                disabled={disabled || selectedRefs.length === 0 || !onCutKeyframes}
                title="Cut selected keyframes"
                aria-label="Cut selected keyframes"
              >
                <Scissors className="h-3 w-3" />
              </Button>
              <Button
                variant={isKeyframeClipboardCut ? 'secondary' : 'ghost'}
                size="sm"
                className="h-6 w-6 p-0"
                onClick={onPasteKeyframes}
                disabled={disabled || !hasKeyframeClipboard || !onPasteKeyframes}
                title={isKeyframeClipboardCut ? 'Move keyframes from clipboard' : 'Paste keyframes'}
                aria-label={isKeyframeClipboardCut ? 'Move keyframes from clipboard' : 'Paste keyframes'}
              >
                <ClipboardPaste className="h-3 w-3" />
              </Button>
              {isKeyframeClipboardCut && hasKeyframeClipboard && (
                <span className="pl-0.5 text-[10px] font-medium text-amber-500">
                  Cut
                </span>
              )}
            </div>
          )}
          <div className="flex items-center rounded-md border border-border/70 bg-background/85 px-0.5 py-0.5">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 text-destructive hover:text-destructive"
              onClick={handleRemoveKeyframes}
              disabled={disabled || selectedRefs.length === 0 || !onRemoveKeyframes}
              title="Remove selected keyframes"
            >
              <Trash2 className="h-3 w-3" />
            </Button>
            <div className="mx-0.5 h-3.5 w-px bg-border/80" />
            <MiniZoomControl
              icon={<MoveHorizontal className="h-3 w-3" />}
              label="Horizontal zoom"
              value={horizontalZoomValue}
              disabled={disabled || horizontalZoomRatioBase <= 1}
              onValueChange={setHorizontalZoomValue}
              onReset={resetViewport}
            />
            {visualizationMode === 'graph' && (
              <>
                <div className="mx-0.5 h-3.5 w-px bg-border/80" />
                <MiniZoomControl
                  icon={<MoveVertical className="h-3 w-3" />}
                  label="Vertical zoom"
                  value={graphVerticalZoomValue}
                  disabled={disabled || visibleGraphProperties.length === 0 || verticalZoomRatioBase <= 1}
                  onValueChange={setGraphVerticalZoomValue}
                  onReset={() => setGraphVerticalZoomValue(0)}
                />
              </>
            )}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                disabled={disabled}
                aria-label={visualizationMode === 'graph' ? 'Graph view options' : 'Sheet view options'}
                title={visualizationMode === 'graph' ? 'Graph view options' : 'Sheet view options'}
              >
                <MoreHorizontal className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[220px]">
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  setGraphRulerUnit('seconds');
                }}
              >
                <Check className={cn('h-3.5 w-3.5', graphRulerUnit !== 'seconds' && 'opacity-0')} />
                Display Time Ruler in Seconds
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  setGraphRulerUnit('frames');
                }}
              >
                <Check className={cn('h-3.5 w-3.5', graphRulerUnit !== 'frames' && 'opacity-0')} />
                Display Time Ruler in Frames
              </DropdownMenuItem>
              {visualizationMode === 'graph' && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={(event) => {
                      event.preventDefault();
                      setShowAllGraphHandles((prev) => !prev);
                    }}
                  >
                    <Check className={cn('h-3.5 w-3.5', !showAllGraphHandles && 'opacity-0')} />
                    Show All Handles
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={(event) => {
                      event.preventDefault();
                      setAutoZoomGraphHeight((prev) => !prev);
                    }}
                  >
                    <Check className={cn('h-3.5 w-3.5', !autoZoomGraphHeight && 'opacity-0')} />
                    Auto Zoom Graph Height
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div
        className={cn(
          'border border-border rounded-md flex-1 min-h-0 overflow-hidden relative',
          disabled && 'opacity-60 pointer-events-none'
        )}
        onWheel={visualizationMode === 'dopesheet' ? handleWheel : undefined}
      >
        <div
          data-testid="dopesheet-playhead-clip"
          className="absolute top-0 bottom-0 right-0 overflow-hidden pointer-events-none z-20"
          style={{ left: PROPERTY_COLUMN_WIDTH }}
        >
          <div
            data-testid="dopesheet-playhead-line"
            className="absolute top-0 bottom-0 w-px bg-primary/80"
            style={{ left: playheadLeft }}
          />
        </div>
        {visualizationMode === 'graph' ? (
          <>
            <div className="grid border-b border-border bg-muted/25" style={propertyGridStyle}>
              <div className="px-1 flex items-center text-[10px] font-medium text-muted-foreground" style={{ height: RULER_HEIGHT }}>
                Property
              </div>
              <div
                data-testid="dopesheet-ruler"
                ref={timelineRef}
                className="relative border-l border-border cursor-ew-resize overflow-hidden"
                style={{ height: RULER_HEIGHT }}
                onPointerDown={handleRulerPointerDown}
                onPointerMove={handleRulerPointerMove}
                onPointerUp={handleRulerPointerUp}
                onPointerCancel={handleRulerPointerUp}
              >
                {rulerTickElements}
              </div>
            </div>

            {propertyRows.length === 0 ? (
              <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                {emptyStateMessage}
              </div>
            ) : (
              <div className="flex min-h-0" style={{ height: `calc(100% - ${RULER_HEIGHT}px)` }}>
                <div className="flex-shrink-0 overflow-auto" style={{ width: PROPERTY_COLUMN_WIDTH }}>
                  {propertyColumnElements}
                </div>
                <div
                  ref={graphPaneRef}
                  data-testid="dopesheet-graph-pane"
                  tabIndex={disabled || graphDisplayPropertyLocked ? undefined : -1}
                  className="min-w-0 flex-1 border-l border-border/60 outline-none"
                  onMouseEnter={focusGraphPane}
                  onPointerDownCapture={focusGraphPane}
                  onKeyDown={handleGraphPaneKeyDown}
                >
                  {graphPaneSize.width > 0 && graphPaneSize.height > 0 && graphVisibleProperties.size > 0 ? (
                    <ValueGraphEditor
                      frameViewport={viewport}
                      onFrameViewportChange={updateViewport}
                      itemId={itemId}
                      keyframesByProperty={keyframesByProperty}
                      selectedProperty={graphDisplayProperty}
                      overlayProperties={[...graphVisibleProperties]}
                      selectedKeyframeIds={selectedKeyframeIds}
                      currentFrame={currentFrame}
                      totalFrames={totalFrames}
                      fps={fps}
                      width={graphPaneSize.width}
                      height={graphPaneSize.height}
                      onKeyframeMove={onKeyframeMove}
                      previewFramesById={timingStripPreviewFrames}
                      constrainFrameDelta={constrainGraphFrameDelta}
                      onBezierHandleMove={onBezierHandleMove}
                      onSelectionChange={onSelectionChange}
                      onPropertyChange={onPropertyChange}
                      onScrub={onScrub}
                      onScrubEnd={onScrubEnd}
                      onDragStart={onDragStart}
                      onDragEnd={onDragEnd}
                      onAddKeyframe={onAddKeyframe}
                      onRemoveKeyframes={onRemoveKeyframes}
                      onNavigateToKeyframe={onNavigateToKeyframe}
                      transitionBlockedRanges={transitionBlockedRanges}
                      snapEnabled={snapEnabled}
                      showToolbar={false}
                      showKeyboardHints={false}
                      borderless
                      showAllHandles={showAllGraphHandles}
                      rulerUnit={graphRulerUnit}
                      autoZoomGraphHeight={autoZoomGraphHeight}
                      externalValueZoomLevel={graphVerticalZoomValue}
                      hideXLabels
                      disabled={disabled || graphDisplayPropertyLocked}
                    />
                  ) : null}
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="grid border-b border-border bg-muted/25" style={propertyGridStyle}>
              <div className="px-1 flex items-center text-[10px] font-medium text-muted-foreground" style={{ height: RULER_HEIGHT }}>
                Property
              </div>
              <div
                data-testid="dopesheet-ruler"
                ref={timelineRef}
                className="relative border-l border-border cursor-ew-resize overflow-hidden"
                style={{ height: RULER_HEIGHT }}
                onPointerDown={handleRulerPointerDown}
                onPointerMove={handleRulerPointerMove}
                onPointerUp={handleRulerPointerUp}
                onPointerCancel={handleRulerPointerUp}
              >
                {rulerTickElements}
              </div>
            </div>

            <div ref={scrollAreaRef} className="overflow-auto" style={{ height: `calc(100% - ${RULER_HEIGHT}px)` }}>
              {sheetRows.length === 0 ? (
                <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                  {emptyStateMessage}
                </div>
              ) : (
                <div className="relative min-h-full">
                  <div
                    data-testid="dopesheet-selection-surface"
                    className="absolute inset-y-0 right-0 z-0"
                    style={{ left: PROPERTY_COLUMN_WIDTH }}
                    onPointerDown={handleTimelineBackgroundPointerDown}
                  />
                  <div className="relative z-10">
                    {rowElements}
                  </div>
                  {marqueeRect && !marqueeJustEndedRef.current && (
                    <KeyframeMarqueeOverlay
                      rect={{
                        ...marqueeRect,
                        x: PROPERTY_COLUMN_WIDTH + marqueeRect.x,
                      }}
                    />
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
      {visualizationMode === 'graph' && (
        <div className="grid" style={propertyGridStyle}>
          <div className="h-4 border-t border-r border-border/60 bg-background/80" />
          <div data-testid="keyframe-timing-strip-viewport-column">
            <KeyframeTimingStrip
              viewport={viewport}
              contentFrameMax={contentFrameMax}
              markers={timingStripMarkers}
              previewFrames={timingStripPreviewFrames}
              disabled={disabled || timingStripMarkers.length === 0}
              onSelectionChange={handleTimingStripSelectionChange}
              onSlideStart={handleTimingStripSlideStart}
              onSlideChange={handleTimingStripSlideChange}
              onSlideEnd={handleTimingStripSlideEnd}
            />
          </div>
        </div>
      )}
      <div className="grid" style={propertyGridStyle}>
        <div
          data-testid="keyframe-navigator-property-column"
          className="h-5 border-t border-r border-border/60 bg-background/80"
        />
        <div data-testid="keyframe-navigator-viewport-column">
          <CompactNavigator
            viewport={viewport}
            currentFrame={currentFrame}
            contentFrameMax={contentFrameMax}
            minVisibleFrames={minViewportFrames}
            disabled={disabled}
            onViewportChange={updateViewport}
          />
        </div>
      </div>
    </div>
  );
});
