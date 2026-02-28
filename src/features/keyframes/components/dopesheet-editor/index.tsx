/**
 * Dopesheet Editor - timeline-style keyframe editor.
 * Shows keyframes across properties as draggable diamonds on a frame grid.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { ChevronLeft, ChevronRight, Maximize2, Plus, Trash2, ZoomIn, ZoomOut, Magnet } from 'lucide-react';
import { cn } from '@/shared/ui/cn';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { AnimatableProperty, Keyframe, KeyframeRef } from '@/types/keyframe';
import { PROPERTY_LABELS } from '@/types/keyframe';
import type { BlockedFrameRange } from '../../utils/transition-region';
import { HOTKEY_OPTIONS } from '@/config/hotkeys';

interface DopesheetEditorProps {
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

interface MarqueeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const PROPERTY_COLUMN_WIDTH = 140;
const MIN_VISIBLE_FRAMES = 20;
const DEFAULT_VISIBLE_FRAMES = 120;
const SNAP_THRESHOLD_PX = 8;
const ROW_HEIGHT = 28;
const RULER_HEIGHT = 24;
const ZOOM_IN_FACTOR = 0.8;
const ZOOM_OUT_FACTOR = 1.25;
const DRAG_THRESHOLD = 2;
const MARQUEE_SCROLL_EDGE_PX = 24;
const MARQUEE_SCROLL_MAX_SPEED = 16;

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

export const DopesheetEditor = memo(function DopesheetEditor({
  itemId,
  keyframesByProperty,
  selectedProperty = null,
  selectedKeyframeIds = new Set(),
  currentFrame = 0,
  totalFrames = 300,
  width = 600,
  height = 260,
  onKeyframeMove,
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
}: DopesheetEditorProps) {
  const timelineRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const [timelineWidth, setTimelineWidth] = useState(0);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [marqueeRect, setMarqueeRect] = useState<MarqueeRect | null>(null);

  const buildDefaultViewport = useCallback((): Viewport => {
    return {
      startFrame: 0,
      endFrame: Math.max(totalFrames, DEFAULT_VISIBLE_FRAMES),
    };
  }, [totalFrames]);

  const [viewport, setViewport] = useState<Viewport>(() => buildDefaultViewport());

  useEffect(() => {
    setViewport(buildDefaultViewport());
  }, [buildDefaultViewport, selectedProperty]);

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

  const visibleProperties = useMemo(() => {
    if (selectedProperty) {
      return availableProperties.filter((p) => p === selectedProperty);
    }
    return availableProperties;
  }, [availableProperties, selectedProperty]);

  const rows = useMemo(
    () =>
      visibleProperties.map((property) => ({
        property,
        keyframes: (keyframesByProperty[property] ?? []).toSorted((a, b) => a.frame - b.frame),
      })),
    [visibleProperties, keyframesByProperty]
  );
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
  const effectiveTimelineWidth = Math.max(timelineWidth, 1);

  const frameToX = useCallback(
    (frame: number) => ((frame - viewport.startFrame) / frameRange) * effectiveTimelineWidth,
    [viewport.startFrame, frameRange, effectiveTimelineWidth]
  );
  const keyframePoints = useMemo(
    () =>
      rows.flatMap((row, rowIndex) =>
        row.keyframes.map((keyframe) => ({
          keyframeId: keyframe.id,
          x: frameToX(keyframe.frame),
          y: rowIndex * ROW_HEIGHT + ROW_HEIGHT / 2,
        }))
      ),
    [rows, frameToX]
  );
  const keyframePointsRef = useRef(keyframePoints);
  keyframePointsRef.current = keyframePoints;

  const xToFrame = useCallback(
    (x: number) => {
      const relative = x / effectiveTimelineWidth;
      return Math.round(viewport.startFrame + relative * frameRange);
    },
    [viewport.startFrame, frameRange, effectiveTimelineWidth]
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

  const sortedFrames = useMemo(() => {
    return [...new Set(visibleKeyframes.map((entry) => entry.keyframe.frame))].toSorted((a, b) => a - b);
  }, [visibleKeyframes]);

  const prevKeyframeFrame = useMemo(() => {
    for (let i = sortedFrames.length - 1; i >= 0; i--) {
      const frame = sortedFrames[i];
      if (frame !== undefined && frame < currentFrame) return frame;
    }
    return null;
  }, [sortedFrames, currentFrame]);

  const nextKeyframeFrame = useMemo(() => {
    for (const frame of sortedFrames) {
      if (frame > currentFrame) return frame;
    }
    return null;
  }, [sortedFrames, currentFrame]);

  const editProperty = selectedProperty ?? availableProperties[0] ?? null;
  const activePropertyKeyframes = editProperty ? keyframesByProperty[editProperty] ?? [] : [];
  const hasKeyframeAtCurrentFrame = activePropertyKeyframes.some((keyframe) => keyframe.frame === currentFrame);

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
      setViewport((prev) => {
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
    [timelineFrameMax]
  );

  const panFrames = useCallback(
    (deltaFrames: number) => {
      if (deltaFrames === 0) return;
      setViewport((prev) => {
        const range = Math.max(1, prev.endFrame - prev.startFrame);
        const maxStart = Math.max(0, timelineFrameMax - range);
        const nextStart = Math.max(0, Math.min(maxStart, prev.startFrame + deltaFrames));
        return {
          startFrame: nextStart,
          endFrame: nextStart + range,
        };
      });
    },
    [timelineFrameMax]
  );

  const resetViewport = useCallback(() => {
    setViewport(buildDefaultViewport());
  }, [buildDefaultViewport]);

  const handlePropertySelect = useCallback(
    (value: string) => {
      const next = value === 'all' ? null : (value as AnimatableProperty);
      onPropertyChange?.(next);
    },
    [onPropertyChange]
  );

  const goToPrevKeyframe = useCallback(() => {
    if (prevKeyframeFrame === null || !onNavigateToKeyframe) return;
    onNavigateToKeyframe(prevKeyframeFrame);
    const match = visibleKeyframes.find((entry) => entry.keyframe.frame === prevKeyframeFrame);
    if (match && onSelectionChange) {
      onSelectionChange(new Set([match.keyframe.id]));
    }
  }, [prevKeyframeFrame, onNavigateToKeyframe, visibleKeyframes, onSelectionChange]);

  const goToNextKeyframe = useCallback(() => {
    if (nextKeyframeFrame === null || !onNavigateToKeyframe) return;
    onNavigateToKeyframe(nextKeyframeFrame);
    const match = visibleKeyframes.find((entry) => entry.keyframe.frame === nextKeyframeFrame);
    if (match && onSelectionChange) {
      onSelectionChange(new Set([match.keyframe.id]));
    }
  }, [nextKeyframeFrame, onNavigateToKeyframe, visibleKeyframes, onSelectionChange]);

  const handleAddKeyframe = useCallback(() => {
    if (!editProperty || !onAddKeyframe) return;
    onAddKeyframe(editProperty, currentFrame);
  }, [editProperty, onAddKeyframe, currentFrame]);

  const handleRemoveKeyframes = useCallback(() => {
    if (!onRemoveKeyframes || selectedRefs.length === 0) return;
    onRemoveKeyframes(selectedRefs);
  }, [onRemoveKeyframes, selectedRefs]);

  const nudgeSelectedKeyframes = useCallback(
    (deltaFrames: number) => {
      if (disabled || !onKeyframeMove || selectedKeyframeIds.size === 0) return;
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
    },
    [disabled, onKeyframeMove, selectedKeyframeIds, totalFrames, transitionBlockedRanges, onDragStart, onDragEnd, itemId]
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

      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [disabled, rowKeyframesByProperty, selectedKeyframeIds, onSelectionChange]
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
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (disabled) return;
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();

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
    [disabled, getTimelineXFromClientX, getContentYFromClientY, selectedKeyframeIds]
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

      for (const selectedId of dragState.selectedKeyframeIds) {
        const initial = dragState.initialFrames.get(selectedId);
        if (initial === undefined) continue;
        const meta = keyframeMetaByIdRef.current.get(selectedId);
        if (!meta) continue;

        let nextFrame = clampFrame(initial + deltaFrames, totalFrames);
        nextFrame = clampToAvoidBlockedRanges(nextFrame, initial, transitionBlockedRanges);
        nextFrame = clampFrame(nextFrame, totalFrames);

        if (nextFrame === meta.keyframe.frame) continue;
        onKeyframeMove(
          { itemId, property: meta.property, keyframeId: selectedId },
          nextFrame,
          meta.keyframe.value
        );
      }
    };

    const handlePointerUp = (event: PointerEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState || dragState.pointerId !== event.pointerId) return;

      if (dragState.started) {
        onDragEnd?.();
      }
      dragStateRef.current = null;
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
  ]);

  const scrubPointerIdRef = useRef<number | null>(null);
  const handleRulerPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (disabled) return;
      event.preventDefault();
      scrubPointerIdRef.current = event.pointerId;
      event.currentTarget.setPointerCapture(event.pointerId);
      onScrub?.(getFrameFromClientX(event.clientX));
    },
    [disabled, onScrub, getFrameFromClientX]
  );

  const handleRulerPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (disabled) return;
      if (scrubPointerIdRef.current !== event.pointerId) return;
      onScrub?.(getFrameFromClientX(event.clientX));
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
  }, []);

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
      const movedEnough = Math.abs(x - marqueeState.startX) > DRAG_THRESHOLD || Math.abs(y - marqueeState.startY) > DRAG_THRESHOLD;
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
    [disabled, getFrameFromClientX, zoomAroundFrame, panFrames, effectiveTimelineWidth, frameRange]
  );

  return (
    <div className={cn('flex flex-col gap-1 h-full overflow-hidden', className)} style={{ height, width }}>
      <div className="flex items-center justify-between px-2 flex-shrink-0 min-h-7">
        <div className="flex items-center gap-2">
          <Select
            value={selectedProperty ?? 'all'}
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
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={goToPrevKeyframe}
            disabled={disabled || prevKeyframeFrame === null || !onNavigateToKeyframe}
            title="Previous keyframe"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={goToNextKeyframe}
            disabled={disabled || nextKeyframeFrame === null || !onNavigateToKeyframe}
            title="Next keyframe"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
          <div className="w-px h-4 bg-border mx-1" />
          <Button
            variant={hasKeyframeAtCurrentFrame ? 'secondary' : 'ghost'}
            size="sm"
            className="h-7 w-7 p-0"
            onClick={handleAddKeyframe}
            disabled={disabled || !editProperty || !onAddKeyframe || hasKeyframeAtCurrentFrame}
            title="Add keyframe at current frame"
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
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
          'border border-border rounded-md flex-1 min-h-0 overflow-hidden',
          disabled && 'opacity-60 pointer-events-none'
        )}
        onWheel={handleWheel}
      >
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
            {ticks.map((frame) => (
              <div
                key={frame}
                className="absolute inset-y-0 border-l border-border/60"
                style={{ left: frameToX(frame) }}
              >
                <span className="absolute top-0.5 left-1 text-[10px] text-muted-foreground">
                  {frame}
                </span>
              </div>
            ))}
            <div
              className="absolute inset-y-0 w-px bg-primary/90 pointer-events-none"
              style={{ left: frameToX(currentFrame) }}
            />
          </div>
        </div>

        <div ref={scrollAreaRef} className="overflow-auto h-[calc(100%-24px)]">
          {rows.length === 0 ? (
            <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
              No keyframes to display
            </div>
          ) : (
            <div className="relative">
              {rows.map((row) => (
                <div key={row.property} className="grid border-b border-border/60" style={{ ...propertyGridStyle, height: ROW_HEIGHT }}>
                  <div className="px-2 flex items-center text-xs text-muted-foreground bg-muted/10">
                    {PROPERTY_LABELS[row.property]}
                  </div>
                  <div
                    className="relative border-l border-border/60 overflow-hidden"
                    onPointerDown={handleRowPointerDown}
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

                    <div
                      className="absolute inset-y-0 w-px bg-primary/70 pointer-events-none"
                      style={{ left: frameToX(currentFrame) }}
                    />

                    {row.keyframes.map((keyframe) => {
                      const selected = selectedKeyframeIds.has(keyframe.id);
                      return (
                        <button
                          key={keyframe.id}
                          type="button"
                          className={cn(
                            'absolute w-3 h-3 -ml-1.5 -mt-1.5 rotate-45 border z-10',
                            selected
                              ? 'bg-primary border-primary shadow-[0_0_0_1px_rgba(255,255,255,0.25)]'
                              : 'bg-orange-500 border-orange-300 hover:bg-orange-400'
                          )}
                          style={{
                            left: frameToX(keyframe.frame),
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
              ))}
              {marqueeRect && !marqueeJustEndedRef.current && (
                <div
                  className="absolute border border-primary/70 bg-primary/20 pointer-events-none z-20"
                  style={{
                    left: PROPERTY_COLUMN_WIDTH + marqueeRect.x,
                    top: marqueeRect.y,
                    width: marqueeRect.width,
                    height: marqueeRect.height,
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

