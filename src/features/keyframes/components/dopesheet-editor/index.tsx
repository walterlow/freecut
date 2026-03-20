/**
 * Dopesheet Editor - timeline-style keyframe editor.
 * Shows keyframes across properties as draggable diamonds on a frame grid.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { ChevronLeft, ChevronRight, Maximize2, Timer, Trash2, ZoomIn, ZoomOut, Magnet } from 'lucide-react';
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
import {
  KEYFRAME_MARQUEE_THRESHOLD,
  KeyframeMarqueeOverlay,
  type KeyframeMarqueeRect,
} from '../keyframe-marquee';
import type { AnimatableProperty, Keyframe, KeyframeRef } from '@/types/keyframe';
import { PROPERTY_LABELS } from '@/types/keyframe';
import type { BlockedFrameRange } from '../../utils/transition-region';
import { HOTKEY_OPTIONS } from '@/config/hotkeys';
import { getFrameAxisX, getFrameFromAxisX, getVisibleKeyframeX } from './layout';
import { getDopesheetRowControlState } from './row-controls';
import { PROPERTY_VALUE_RANGES } from '@/features/keyframes/property-value-ranges';
import { useAutoKeyframeStore } from '../../stores/auto-keyframe-store';

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
  /** Width of the editor */
  width?: number;
  /** Height of the editor */
  height?: number;
  /** Callback when keyframe is moved */
  onKeyframeMove?: (ref: KeyframeRef, newFrame: number, newValue: number) => void;
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
  /** Callback to navigate to a keyframe */
  onNavigateToKeyframe?: (frame: number) => void;
  /** Transition-blocked frame ranges (keyframes cannot be placed here) */
  transitionBlockedRanges?: BlockedFrameRange[];
  /** Whether the editor is disabled */
  disabled?: boolean;
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

interface DragState {
  anchorKeyframeId: string;
  selectedKeyframeIds: string[];
  initialFrames: Map<string, number>;
  startClientX: number;
  pointerId: number;
  started: boolean;
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

const PROPERTY_COLUMN_WIDTH = 290;
const MIN_VISIBLE_FRAMES = 20;
const DEFAULT_VISIBLE_FRAMES = 120;
const SNAP_THRESHOLD_PX = 8;
const ROW_HEIGHT = 36;
const RULER_HEIGHT = 26;
const ZOOM_IN_FACTOR = 0.8;
const ZOOM_OUT_FACTOR = 1.25;
const DRAG_THRESHOLD = 2;
const MARQUEE_SCROLL_EDGE_PX = 24;
const MARQUEE_SCROLL_MAX_SPEED = 16;
const EMPTY_AUTO_KEY_ENABLED_BY_PROPERTY: Partial<Record<AnimatableProperty, boolean>> = {};

function clampFrame(frame: number, totalFrames: number): number {
  if (totalFrames <= 0) return 0;
  return Math.max(0, Math.min(totalFrames - 1, frame));
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

function clampToAvoidBlockedRanges(
  frame: number,
  initialFrame: number,
  blockedRanges: BlockedFrameRange[]
): number {
  if (blockedRanges.length === 0) return frame;
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
  width = 600,
  height = 260,
  onKeyframeMove,
  onSelectionChange,
  onPropertyChange,
  onActivePropertyChange,
  onScrub,
  onScrubEnd,
  onDragStart,
  onDragEnd,
  onAddKeyframe,
  propertyValues = {},
  onPropertyValueCommit,
  onRemoveKeyframes,
  onNavigateToKeyframe,
  transitionBlockedRanges = [],
  disabled = false,
  className,
}: DopesheetEditorProps) {
  const timelineRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const bodyTimelineRef = useRef<HTMLDivElement>(null);
  const keyframeButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const [timelineWidth, setTimelineWidth] = useState(0);
  const [bodyTimelineWidth, setBodyTimelineWidth] = useState(0);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [marqueeRect, setMarqueeRect] = useState<KeyframeMarqueeRect | null>(null);
  const [valueDrafts, setValueDrafts] = useState<Partial<Record<AnimatableProperty, string>>>({});
  const [editingValueProperty, setEditingValueProperty] = useState<AnimatableProperty | null>(null);
  const autoKeyEnabledByProperty = useAutoKeyframeStore(
    useCallback(
      (state) => state.enabledByItem[itemId] ?? EMPTY_AUTO_KEY_ENABLED_BY_PROPERTY,
      [itemId]
    )
  );
  const toggleAutoKeyframeEnabled = useAutoKeyframeStore((state) => state.toggleAutoKeyframeEnabled);
  const [localFrameInputValue, setLocalFrameInputValue] = useState('');
  const [globalFrameInputValue, setGlobalFrameInputValue] = useState('');
  const skipNextBlurCommitPropertyRef = useRef<AnimatableProperty | null>(null);
  const skipNextHeaderFrameBlurRef = useRef<'local' | 'global' | null>(null);
  const appliedDragPreviewFramesRef = useRef<Record<string, number> | null>(null);

  const buildDefaultViewport = useCallback((): Viewport => {
    return {
      startFrame: 0,
      endFrame: Math.max(totalFrames, DEFAULT_VISIBLE_FRAMES),
    };
  }, [totalFrames]);

  const [viewport, setViewport] = useState<Viewport>(() => frameViewport ?? buildDefaultViewport());
  const updateViewport = useCallback(
    (next: Viewport | ((prev: Viewport) => Viewport)) => {
      setViewport((prev) => {
        const resolved = typeof next === 'function' ? next(prev) : next;
        if (resolved.startFrame !== prev.startFrame || resolved.endFrame !== prev.endFrame) {
          onFrameViewportChange?.(resolved);
        }
        return resolved;
      });
    },
    [onFrameViewportChange]
  );

  useEffect(() => {
    setViewport(frameViewport ?? buildDefaultViewport());
  }, [buildDefaultViewport, frameViewport, selectedProperty]);

  useEffect(() => {
    if (!frameViewport) return;
    setViewport((prev) => {
      if (
        prev.startFrame === frameViewport.startFrame &&
        prev.endFrame === frameViewport.endFrame
      ) {
        return prev;
      }
      return frameViewport;
    });
  }, [frameViewport]);

  useEffect(() => {
    const node = timelineRef.current;
    if (!node) return;

    const updateWidth = () => {
      setTimelineWidth(node.clientWidth);
    };

    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const availableProperties = useMemo(
    () => Object.keys(keyframesByProperty) as AnimatableProperty[],
    [keyframesByProperty]
  );
  const activeSelectedProperty = selectedProperty && availableProperties.includes(selectedProperty)
    ? selectedProperty
    : null;

  const visibleProperties = useMemo(() => {
    if (activeSelectedProperty) {
      return availableProperties.filter((p) => p === activeSelectedProperty);
    }
    return availableProperties;
  }, [availableProperties, activeSelectedProperty]);

  const rows = useMemo(
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

  useEffect(() => {
    const node = bodyTimelineRef.current;
    if (!node) return;

    const updateWidth = () => {
      setBodyTimelineWidth(node.clientWidth);
    };

    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(node);
    return () => observer.disconnect();
  }, [rows.length]);

  const formatPropertyValue = useCallback((property: AnimatableProperty, value: number | undefined) => {
    if (value === undefined || Number.isNaN(value)) return '';
    const decimals = PROPERTY_VALUE_RANGES[property].decimals;
    return decimals === 0 ? String(Math.round(value)) : value.toFixed(decimals);
  }, []);

  useEffect(() => {
    setValueDrafts((prev) => {
      let changed = false;
      const nextDrafts = { ...prev };

      for (const property of visibleProperties) {
        if (editingValueProperty === property) continue;
        const nextValue = formatPropertyValue(property, propertyValues[property]);
        if (nextDrafts[property] !== nextValue) {
          nextDrafts[property] = nextValue;
          changed = true;
        }
      }

      return changed ? nextDrafts : prev;
    });
  }, [visibleProperties, propertyValues, editingValueProperty, formatPropertyValue]);
  const rowKeyframesByProperty = useMemo(() => {
    const map = new Map<AnimatableProperty, Keyframe[]>();
    for (const row of rows) {
      map.set(row.property, row.keyframes);
    }
    return map;
  }, [rows]);

  const keyframeMetaById = useMemo(() => {
    const map = new Map<string, KeyframeMeta>();
    for (const row of rows) {
      for (const keyframe of row.keyframes) {
        map.set(keyframe.id, { property: row.property, keyframe });
      }
    }
    return map;
  }, [rows]);

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

  useEffect(() => {
    setLocalFrameInputValue(
      selectedFrameSummary.localFrame === null ? '' : String(selectedFrameSummary.localFrame)
    );
    setGlobalFrameInputValue(
      selectedFrameSummary.globalFrame === null ? '' : String(selectedFrameSummary.globalFrame)
    );
  }, [selectedFrameSummary.globalFrame, selectedFrameSummary.localFrame]);

  const visibleKeyframes = useMemo(
    () =>
      rows.flatMap((row) =>
        row.keyframes.map((keyframe) => ({
          property: row.property,
          keyframe,
        }))
      ),
    [rows]
  );

  const frameRange = Math.max(1, viewport.endFrame - viewport.startFrame);
  const timelineFrameMax = Math.max(totalFrames, DEFAULT_VISIBLE_FRAMES) * 4;
  const fallbackTimelineWidth = Math.max(width - PROPERTY_COLUMN_WIDTH, 1);
  const effectiveTimelineWidth = Math.max(
    bodyTimelineWidth || timelineWidth || fallbackTimelineWidth,
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

      const keyframeIds = new Set([
        ...Object.keys(previousPreviewFrames ?? {}),
        ...Object.keys(nextPreviewFrames ?? {}),
      ]);

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
  const renderedKeyframeXById = useMemo(() => {
    const positions = new Map<string, number>();
    for (const row of rows) {
      for (const keyframe of row.keyframes) {
        const x = getRenderedKeyframeX(keyframe.frame);
        if (x !== null) {
          positions.set(keyframe.id, x);
        }
      }
    }
    return positions;
  }, [rows, getRenderedKeyframeX]);
  const keyframePoints = useMemo(
    () =>
      rows.flatMap((row, rowIndex) =>
        row.keyframes.flatMap((keyframe) => {
          const x = renderedKeyframeXById.get(keyframe.id);
          if (x === undefined) return [];
          return [{
            keyframeId: keyframe.id,
            x,
            y: rowIndex * ROW_HEIGHT + ROW_HEIGHT / 2,
          }];
        })
      ),
    [rows, renderedKeyframeXById]
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
      const maxY = Math.max(0, rows.length * ROW_HEIGHT);
      return Math.max(0, Math.min(maxY, y));
    },
    [rows.length]
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
      refs.push({
        itemId,
        property: meta.property,
        keyframeId,
      });
    }
    return refs;
  }, [selectedKeyframeIds, keyframeMetaById, itemId]);

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
        const nextRange = Math.max(MIN_VISIBLE_FRAMES, Math.round(prevRange * factor));
        const ratio = (centerFrame - prev.startFrame) / prevRange;
        let nextStart = Math.round(centerFrame - ratio * nextRange);
        let nextEnd = nextStart + nextRange;

        if (nextStart < 0) {
          nextEnd -= nextStart;
          nextStart = 0;
        }
        if (nextEnd > timelineFrameMax) {
          const overflow = nextEnd - timelineFrameMax;
          nextStart = Math.max(0, nextStart - overflow);
          nextEnd = timelineFrameMax;
        }
        return { startFrame: nextStart, endFrame: nextEnd };
      });
    },
    [timelineFrameMax, updateViewport]
  );

  const panFrames = useCallback(
    (deltaFrames: number) => {
      if (deltaFrames === 0) return;
      updateViewport((prev) => {
        const range = Math.max(1, prev.endFrame - prev.startFrame);
        const maxStart = Math.max(0, timelineFrameMax - range);
        const nextStart = Math.max(0, Math.min(maxStart, prev.startFrame + deltaFrames));
        return {
          startFrame: nextStart,
          endFrame: nextStart + range,
        };
      });
    },
    [timelineFrameMax, updateViewport]
  );

  const resetViewport = useCallback(() => {
    updateViewport(buildDefaultViewport());
  }, [buildDefaultViewport, updateViewport]);

  const handlePropertySelect = useCallback(
    (value: string) => {
      const next = value === 'all' ? null : (value as AnimatableProperty);
      onPropertyChange?.(next);
      if (next) {
        onActivePropertyChange?.(next);
      }
    },
    [onActivePropertyChange, onPropertyChange]
  );

  const handleRemoveKeyframes = useCallback(() => {
    if (!onRemoveKeyframes || selectedRefs.length === 0) return;
    onRemoveKeyframes(selectedRefs);
  }, [onRemoveKeyframes, selectedRefs]);

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
      if (disabled || !onKeyframeMove || selectedKeyframeIds.size === 0 || deltaFrames === 0) {
        return false;
      }

      let hasChanges = false;
      onDragStart?.();
      for (const keyframeId of selectedKeyframeIds) {
        const meta = keyframeMetaByIdRef.current.get(keyframeId);
        if (!meta) continue;
        const initialFrame = meta.keyframe.frame;
        let nextFrame = clampFrame(initialFrame + deltaFrames, totalFrames);
        nextFrame = clampToAvoidBlockedRanges(nextFrame, initialFrame, transitionBlockedRanges);
        nextFrame = clampFrame(nextFrame, totalFrames);
        if (nextFrame === meta.keyframe.frame) continue;
        onKeyframeMove(
          { itemId, property: meta.property, keyframeId },
          nextFrame,
          meta.keyframe.value
        );
        hasChanges = true;
      }
      if (hasChanges) {
        onDragEnd?.();
      }
      return hasChanges;
    },
    [
      disabled,
      itemId,
      onDragEnd,
      onDragStart,
      onKeyframeMove,
      selectedKeyframeIds,
      totalFrames,
      transitionBlockedRanges,
    ]
  );

  const commitLocalFrameInput = useCallback(() => {
    if (
      selectedFrameSummary.localFrame === null ||
      selectedFrameSummary.hasMixedFrames ||
      !onKeyframeMove
    ) {
      resetHeaderFrameInputs();
      return;
    }

    const parsed = Math.round(Number(localFrameInputValue));
    if (!Number.isFinite(parsed)) {
      resetHeaderFrameInputs();
      return;
    }

    let targetFrame = clampFrame(parsed, totalFrames);
    targetFrame = clampToAvoidBlockedRanges(
      targetFrame,
      selectedFrameSummary.localFrame,
      transitionBlockedRanges
    );
    targetFrame = clampFrame(targetFrame, totalFrames);
    const deltaFrames = targetFrame - selectedFrameSummary.localFrame;

    setLocalFrameInputValue(String(targetFrame));
    if (selectedFrameSummary.globalFrame !== null) {
      const frameOffset = selectedFrameSummary.globalFrame - selectedFrameSummary.localFrame;
      setGlobalFrameInputValue(String(targetFrame + frameOffset));
    }

    if (!moveSelectedKeyframesByDelta(deltaFrames)) {
      return;
    }

    onNavigateToKeyframe?.(targetFrame);
  }, [
    localFrameInputValue,
    moveSelectedKeyframesByDelta,
    onKeyframeMove,
    onNavigateToKeyframe,
    resetHeaderFrameInputs,
    selectedFrameSummary.globalFrame,
    selectedFrameSummary.hasMixedFrames,
    selectedFrameSummary.localFrame,
    totalFrames,
    transitionBlockedRanges,
  ]);

  const commitGlobalFrameInput = useCallback(() => {
    if (
      globalFrame === null ||
      selectedFrameSummary.localFrame === null ||
      selectedFrameSummary.hasMixedFrames ||
      !onKeyframeMove
    ) {
      resetHeaderFrameInputs();
      return;
    }

    const parsed = Math.round(Number(globalFrameInputValue));
    if (!Number.isFinite(parsed)) {
      resetHeaderFrameInputs();
      return;
    }

    const frameOffset = globalFrame - currentFrame;
    let nextLocalFrame = clampFrame(parsed - frameOffset, totalFrames);
    nextLocalFrame = clampToAvoidBlockedRanges(
      nextLocalFrame,
      selectedFrameSummary.localFrame,
      transitionBlockedRanges
    );
    nextLocalFrame = clampFrame(nextLocalFrame, totalFrames);
    const normalizedGlobalFrame = nextLocalFrame + frameOffset;
    const deltaFrames = nextLocalFrame - selectedFrameSummary.localFrame;

    setLocalFrameInputValue(String(nextLocalFrame));
    setGlobalFrameInputValue(String(normalizedGlobalFrame));

    if (!moveSelectedKeyframesByDelta(deltaFrames)) {
      return;
    }

    onNavigateToKeyframe?.(nextLocalFrame);
  }, [
    currentFrame,
    globalFrame,
    globalFrameInputValue,
    moveSelectedKeyframesByDelta,
    onKeyframeMove,
    onNavigateToKeyframe,
    resetHeaderFrameInputs,
    selectedFrameSummary.hasMixedFrames,
    selectedFrameSummary.localFrame,
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

  const handleRowNavigate = useCallback(
    (property: AnimatableProperty, keyframe: Keyframe | null) => {
      if (!keyframe || !onNavigateToKeyframe) return;
      onActivePropertyChange?.(property);
      onNavigateToKeyframe(keyframe.frame);
      onSelectionChange?.(new Set([keyframe.id]));
      selectionAnchorByPropertyRef.current.set(property, keyframe.id);
    },
    [onActivePropertyChange, onNavigateToKeyframe, onSelectionChange]
  );

  const handleRowToggleKeyframe = useCallback(
    (property: AnimatableProperty, currentKeyframes: Keyframe[]) => {
      onActivePropertyChange?.(property);
      if (currentKeyframes.length > 0) {
        if (!onRemoveKeyframes) return;
        const refs = currentKeyframes.map((keyframe) => ({
          itemId,
          property,
          keyframeId: keyframe.id,
        }));
        onRemoveKeyframes(refs);
        if (onSelectionChange) {
          const nextSelection = new Set(selectedKeyframeIds);
          for (const keyframe of currentKeyframes) {
            nextSelection.delete(keyframe.id);
          }
          onSelectionChange(nextSelection);
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
      onActivePropertyChange,
      onAddKeyframe,
      onRemoveKeyframes,
      onSelectionChange,
      selectedKeyframeIds,
    ]
  );

  const handleRowValueChange = useCallback((property: AnimatableProperty, value: string) => {
    setValueDrafts((prev) => ({ ...prev, [property]: value }));
  }, []);

  const handleRowAutoKeyToggle = useCallback((property: AnimatableProperty) => {
    onActivePropertyChange?.(property);
    toggleAutoKeyframeEnabled(itemId, property);
  }, [itemId, onActivePropertyChange, toggleAutoKeyframeEnabled]);

  const handleRowValueCommit = useCallback(
    (property: AnimatableProperty, options?: { allowCreate?: boolean }) => {
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
    [formatPropertyValue, onPropertyValueCommit, propertyValues, valueDrafts]
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

  const handleKeyframePointerDown = useCallback(
    (
      property: AnimatableProperty,
      keyframeId: string,
      event: React.PointerEvent<HTMLButtonElement>
    ) => {
      if (disabled) return;
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
      };
      scheduleDragPreviewFrames(null);

      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [
      disabled,
      onActivePropertyChange,
      rowKeyframesByProperty,
      scheduleDragPreviewFrames,
      selectedKeyframeIds,
      onSelectionChange,
    ]
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
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      onActivePropertyChange?.(property);

      const mode: MarqueeMode = event.shiftKey
        ? 'add'
        : (event.ctrlKey || event.metaKey)
          ? 'toggle'
          : 'replace';

      const startX = getTimelineXFromClientX(event.clientX);
      const startY = getContentYFromClientY(event.clientY);
      marqueeStateRef.current = {
        pointerId: event.pointerId,
        startX,
        startY,
        currentX: startX,
        currentY: startY,
        mode,
        baseSelection: new Set(selectedKeyframeIds),
        started: false,
      };

      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [disabled, getTimelineXFromClientX, getContentYFromClientY, onActivePropertyChange, selectedKeyframeIds]
  );

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      if (disabled || !onKeyframeMove) return;
      const dragState = dragStateRef.current;
      if (!dragState) return;
      if (dragState.pointerId !== event.pointerId) return;

      const deltaX = event.clientX - dragState.startClientX;
      if (!dragState.started && Math.abs(deltaX) > DRAG_THRESHOLD) {
        dragState.started = true;
        onDragStart?.();
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

      const nextPreviewFrames: Record<string, number> = {};
      for (const selectedId of dragState.selectedKeyframeIds) {
        const initial = dragState.initialFrames.get(selectedId);
        if (initial === undefined) continue;
        const meta = keyframeMetaByIdRef.current.get(selectedId);
        if (!meta) continue;

        let nextFrame = clampFrame(initial + deltaFrames, totalFrames);
        nextFrame = clampToAvoidBlockedRanges(nextFrame, initial, transitionBlockedRanges);
        nextFrame = clampFrame(nextFrame, totalFrames);

        if (nextFrame === meta.keyframe.frame) continue;
        nextPreviewFrames[selectedId] = nextFrame;
      }

      scheduleDragPreviewFrames(
        Object.keys(nextPreviewFrames).length > 0 ? nextPreviewFrames : null
      );
    };

    const handlePointerUp = (event: PointerEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState || dragState.pointerId !== event.pointerId) return;

      if (dragState.started) {
        const previewFrames = appliedDragPreviewFramesRef.current;
        if (previewFrames) {
          for (const selectedId of dragState.selectedKeyframeIds) {
            const nextFrame = previewFrames[selectedId];
            if (nextFrame === undefined) continue;
            const meta = keyframeMetaByIdRef.current.get(selectedId);
            if (!meta) continue;
            onKeyframeMove(
              { itemId, property: meta.property, keyframeId: selectedId },
              nextFrame,
              meta.keyframe.value
            );
          }
        }
        onDragEnd?.();
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
    onKeyframeMove,
    onDragStart,
    onDragEnd,
    effectiveTimelineWidth,
    frameRange,
    totalFrames,
    itemId,
    snapEnabled,
    snapFrame,
    transitionBlockedRanges,
    scheduleDragPreviewFrames,
  ]);

  const scrubPointerIdRef = useRef<number | null>(null);
  const lastScrubbedFrameRef = useRef<number | null>(null);
  const handleRulerPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (disabled) return;
      event.preventDefault();
      scrubPointerIdRef.current = event.pointerId;
      event.currentTarget.setPointerCapture(event.pointerId);
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

  const playheadLeft = frameToX(currentFrame);
  const rulerTickElements = useMemo(
    () =>
      ticks.map((frame) => (
        <div
          key={frame}
          className="absolute inset-y-0 border-l border-border/60"
          style={{ left: frameToX(frame) }}
        >
          <span className="absolute top-0.5 left-1 text-[10px] text-muted-foreground">
            {frame}
          </span>
        </div>
      )),
    [ticks, frameToX]
  );
  const rowElements = useMemo(
    () =>
      rows.map((row) => (
        <div key={row.property} className="grid border-b border-border/60" style={{ ...propertyGridStyle, height: ROW_HEIGHT }}>
          <div
            className={cn(
              'px-2 flex items-center gap-2 bg-muted/10',
              row.controls.hasKeyframeAtCurrentFrame && 'bg-primary/10'
            )}
          >
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(
                'h-5 w-5 flex-shrink-0 p-0 text-muted-foreground hover:text-foreground',
                autoKeyEnabledByProperty[row.property] &&
                  'bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground'
              )}
              onClick={() => handleRowAutoKeyToggle(row.property)}
              disabled={disabled || !onPropertyValueCommit}
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
              <Timer className="h-3 w-3" />
            </Button>
            <div className="min-w-0 flex-1 truncate text-[11px] font-medium text-foreground">
              {PROPERTY_LABELS[row.property]}
            </div>
            <div className="flex items-center gap-1 ml-auto">
              <Input
                type="number"
                value={valueDrafts[row.property] ?? ''}
                onChange={(event) => handleRowValueChange(row.property, event.target.value)}
                onFocus={() => {
                  onActivePropertyChange?.(row.property);
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
                className="h-6 w-[82px] border-border/70 bg-background/85 px-1.5 text-[11px]"
                disabled={
                  disabled ||
                  !onPropertyValueCommit ||
                  (!row.controls.hasKeyframeAtCurrentFrame && isCurrentFrameBlocked)
                }
                aria-label={`${PROPERTY_LABELS[row.property]} value at playhead`}
              />
              <div className="flex items-center gap-0.5 rounded-md border border-border/70 bg-background/85 p-0.5">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-5 w-5 p-0 text-muted-foreground hover:text-foreground"
                onClick={() => handleRowNavigate(row.property, row.controls.prevKeyframe)}
                disabled={disabled || row.controls.prevKeyframe === null || !onNavigateToKeyframe}
                title={`Previous ${PROPERTY_LABELS[row.property]} keyframe`}
              >
                <ChevronLeft className="h-3 w-3" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={cn(
                  'h-5 w-5 p-0 hover:bg-transparent',
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
                  (!row.controls.hasKeyframeAtCurrentFrame &&
                    (isCurrentFrameBlocked || !onAddKeyframe))
                }
                title={
                  row.controls.hasKeyframeAtCurrentFrame
                    ? `Remove ${PROPERTY_LABELS[row.property]} keyframe at playhead`
                    : `Toggle ${PROPERTY_LABELS[row.property]} keyframe at playhead`
                }
              >
                <span
                  className={cn(
                    'block h-2.5 w-2.5 rotate-45 border transition-colors',
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
                className="h-5 w-5 p-0 text-muted-foreground hover:text-foreground"
                onClick={() => handleRowNavigate(row.property, row.controls.nextKeyframe)}
                disabled={disabled || row.controls.nextKeyframe === null || !onNavigateToKeyframe}
                title={`Next ${PROPERTY_LABELS[row.property]} keyframe`}
              >
                <ChevronRight className="h-3 w-3" />
              </Button>
              </div>
            </div>
          </div>
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
                  className={cn(
                    'absolute w-3 h-3 -ml-1.5 -mt-1.5 rotate-45 border z-10',
                    selected
                      ? 'bg-orange-500 border-orange-50 shadow-[0_0_0_1px_rgba(249,115,22,0.45)]'
                      : 'bg-orange-500 border-transparent hover:bg-orange-400'
                  )}
                  style={{
                    left: renderedX,
                    top: '50%',
                  }}
                  onPointerDown={(event) =>
                    handleKeyframePointerDown(row.property, keyframe.id, event)
                  }
                  onClick={(event) => event.stopPropagation()}
                  aria-label={`Keyframe at frame ${keyframe.frame}`}
                />
              );
            })}
          </div>
        </div>
      )),
    [
      rows,
      propertyGridStyle,
      disabled,
      autoKeyEnabledByProperty,
      formatPropertyValue,
      handleRowPointerDown,
      handleRowAutoKeyToggle,
      handleRowNavigate,
      handleRowToggleKeyframe,
      handleRowValueChange,
      handleRowValueCommit,
      isCurrentFrameBlocked,
      onActivePropertyChange,
      onAddKeyframe,
      onNavigateToKeyframe,
      onPropertyValueCommit,
      propertyValues,
      ticks,
      frameToX,
      transitionBlockedRanges,
      valueDrafts,
      selectedKeyframeIds,
      handleKeyframePointerDown,
      setKeyframeButtonRef,
    ]
  );

  return (
    <div className={cn('flex flex-col gap-1 h-full overflow-hidden', className)} style={{ height, width }}>
      <div className="flex items-center justify-between px-2 flex-shrink-0 min-h-7">
        <div className="flex items-center gap-2">
          <Select
            value={activeSelectedProperty ?? 'all'}
            onValueChange={handlePropertySelect}
            disabled={disabled || availableProperties.length === 0}
          >
            <SelectTrigger className="w-[140px] h-7 text-xs focus:ring-0 focus:ring-offset-0">
              <SelectValue placeholder="Select property" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">All Properties</SelectItem>
              {availableProperties.map((property) => (
                <SelectItem key={property} value={property} className="text-xs">
                  {PROPERTY_LABELS[property]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

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

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 text-destructive hover:text-destructive"
            onClick={handleRemoveKeyframes}
            disabled={disabled || selectedRefs.length === 0 || !onRemoveKeyframes}
            title="Remove selected keyframes"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
          <div className="w-px h-4 bg-border mx-1" />
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              'h-7 w-7 p-0',
              snapEnabled && 'bg-primary text-primary-foreground hover:bg-primary/90'
            )}
            onClick={() => setSnapEnabled((prev) => !prev)}
            disabled={disabled}
            title={snapEnabled ? 'Snapping enabled' : 'Enable snapping'}
          >
            <Magnet className="h-3.5 w-3.5" />
          </Button>
          <div className="w-px h-4 bg-border mx-1" />
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => zoomAroundFrame(currentFrame, ZOOM_OUT_FACTOR)}
            disabled={disabled}
            title="Zoom out"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => zoomAroundFrame(currentFrame, ZOOM_IN_FACTOR)}
            disabled={disabled}
            title="Zoom in"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={resetViewport}
            disabled={disabled}
            title="Fit to clip"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div
        className={cn(
          'border border-border rounded-md flex-1 min-h-0 overflow-hidden relative',
          disabled && 'opacity-60 pointer-events-none'
        )}
        onWheel={handleWheel}
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
        <div className="grid border-b border-border bg-muted/25" style={propertyGridStyle}>
          <div className="px-2 flex items-center text-[11px] text-muted-foreground font-medium" style={{ height: RULER_HEIGHT }}>
            Property
          </div>
          <div
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

        <div ref={scrollAreaRef} className="overflow-auto h-[calc(100%-24px)]">
          {rows.length === 0 ? (
            <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
              No keyframes to display
            </div>
          ) : (
            <div ref={bodyTimelineRef} className="relative">
              {rowElements}
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
      </div>
    </div>
  );
});
