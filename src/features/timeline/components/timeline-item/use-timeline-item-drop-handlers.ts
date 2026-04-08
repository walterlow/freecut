import { useCallback } from 'react';
import { toast } from 'sonner';
import type { TimelineItem as TimelineItemType } from '@/types/timeline';
import { getMediaDragData } from '@/features/timeline/deps/media-library-resolver';
import {
  TRANSITION_DRAG_MIME,
  useTransitionDragStore,
  type DraggedTransitionDescriptor,
} from '@/shared/state/transition-drag';
import { useSelectionStore } from '@/shared/state/selection';
import { useTimelineStore } from '../../stores/timeline-store';
import { useItemsStore } from '../../stores/items-store';
import { useTransitionsStore } from '../../stores/transitions-store';
import { useEffectDropPreviewStore } from '../../stores/effect-drop-preview-store';
import { useTrackDropPreviewStore } from '../../stores/track-drop-preview-store';
import { resolveTransitionTargetForEdge } from '@/features/timeline/utils/transition-targets';
import {
  isDragPointInsideElement,
  resolveEffectDropTargetIds,
} from '../../utils/effect-drop';
import { getTemplateEffectsForDirectApplication } from '../../utils/generated-layer-items';

type AddEffects = ReturnType<typeof useTimelineStore.getState>['addEffects'];

interface UseTimelineItemDropHandlersParams {
  item: TimelineItemType;
  trackLocked: boolean;
  draggedTransition: DraggedTransitionDescriptor | null;
  addEffects: AddEffects;
}

function readDraggedTransitionDescriptor(event: React.DragEvent): DraggedTransitionDescriptor | null {
  const cached = useTransitionDragStore.getState().draggedTransition;
  if (cached) {
    return cached;
  }

  const raw = event.dataTransfer.getData(TRANSITION_DRAG_MIME);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<DraggedTransitionDescriptor>;
    if (typeof parsed.presentation !== 'string') {
      return null;
    }

    return {
      presentation: parsed.presentation,
      direction: parsed.direction,
    };
  } catch {
    return null;
  }
}

export function useTimelineItemDropHandlers({
  item,
  trackLocked,
  draggedTransition,
  addEffects,
}: UseTimelineItemDropHandlersParams) {
  const handleTransitionCutDragOver = useCallback((edge: 'left' | 'right') => (e: React.DragEvent<HTMLDivElement>) => {
    const dragDescriptor = readDraggedTransitionDescriptor(e);
    if (!dragDescriptor || trackLocked || !draggedTransition) {
      return;
    }

    const dragState = useTransitionDragStore.getState();
    const target = resolveTransitionTargetForEdge({
      itemId: item.id,
      edge,
      items: useItemsStore.getState().items,
      transitions: useTransitionsStore.getState().transitions,
    });

    if (!target) {
      dragState.clearPreview();
      dragState.setInvalidHint({
        x: e.clientX,
        y: e.clientY,
        message: 'No adjacent clip on this edge',
      });
      return;
    }

    if (target.hasExisting) {
      dragState.clearPreview();
      dragState.setInvalidHint({
        x: e.clientX,
        y: e.clientY,
        message: 'Drop on the existing transition bridge to replace it',
      });
      return;
    }

    if (!target.canApply) {
      dragState.clearPreview();
      dragState.setInvalidHint({
        x: e.clientX,
        y: e.clientY,
        message: target.reason ?? 'This cut cannot accept a transition',
      });
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    dragState.setInvalidHint(null);
    dragState.setPreview({
      leftClipId: target.leftClipId,
      rightClipId: target.rightClipId,
      durationInFrames: target.suggestedDurationInFrames,
      alignment: target.alignment,
    });
  }, [draggedTransition, item.id, trackLocked]);

  const handleTransitionCutDragLeave = useCallback(() => {
    const dragState = useTransitionDragStore.getState();
    const preview = dragState.preview;
    if (!preview || preview.existingTransitionId) {
      return;
    }

    if (preview.leftClipId === item.id || preview.rightClipId === item.id) {
      dragState.clearPreview();
    }
    dragState.setInvalidHint(null);
  }, [item.id]);

  const handleTransitionCutDrop = useCallback((edge: 'left' | 'right') => (e: React.DragEvent<HTMLDivElement>) => {
    const dragDescriptor = readDraggedTransitionDescriptor(e);
    if (!dragDescriptor || trackLocked) {
      return;
    }

    const target = resolveTransitionTargetForEdge({
      itemId: item.id,
      edge,
      items: useItemsStore.getState().items,
      transitions: useTransitionsStore.getState().transitions,
    });

    if (!target || target.hasExisting || !target.canApply) {
      useTransitionDragStore.getState().clearDrag();
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    useTimelineStore.getState().addTransition(
      target.leftClipId,
      target.rightClipId,
      'crossfade',
      target.suggestedDurationInFrames,
      dragDescriptor.presentation,
      dragDescriptor.direction,
    );
    useTransitionDragStore.getState().clearDrag();
  }, [item.id, trackLocked]);

  const resolveDirectEffectDropTemplate = useCallback((payload: unknown) => {
    const effects = getTemplateEffectsForDirectApplication(payload);
    if (!effects || trackLocked || item.type === 'audio') {
      return null;
    }

    return effects;
  }, [item.type, trackLocked]);

  const resolveEffectDropTargets = useCallback((payload: unknown): string[] => {
    const effects = resolveDirectEffectDropTemplate(payload);
    if (!effects) {
      return [];
    }

    const items = useItemsStore.getState().items;
    const itemById = new Map(items.map((timelineItem) => [timelineItem.id, timelineItem]));
    const lockedTrackIds = new Set(
      useTimelineStore.getState().tracks
        .filter((track) => track.locked)
        .map((track) => track.id)
    );
    const selectedItemIds = useSelectionStore.getState().selectedItemIds;

    return resolveEffectDropTargetIds({
      hoveredItemId: item.id,
      items,
      selectedItemIds,
    }).filter((itemId) => !lockedTrackIds.has(itemById.get(itemId)?.trackId ?? ''));
  }, [item.id, resolveDirectEffectDropTemplate]);

  const setEffectDropPreview = useCallback((targetItemIds: string[]) => {
    if (targetItemIds.length === 0) {
      useEffectDropPreviewStore.getState().clearPreview();
      return;
    }

    useEffectDropPreviewStore.getState().setPreview(targetItemIds, item.id);
  }, [item.id]);

  const handleEffectDragEnter = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    const targetItemIds = resolveEffectDropTargets(getMediaDragData());
    if (targetItemIds.length === 0) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    setEffectDropPreview(targetItemIds);
    useTrackDropPreviewStore.getState().clearGhostPreviews();
  }, [resolveEffectDropTargets, setEffectDropPreview]);

  const handleEffectDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    const targetItemIds = resolveEffectDropTargets(getMediaDragData());
    if (targetItemIds.length === 0) {
      useEffectDropPreviewStore.getState().clearPreview();
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    setEffectDropPreview(targetItemIds);
    useTrackDropPreviewStore.getState().clearGhostPreviews();
  }, [resolveEffectDropTargets, setEffectDropPreview]);

  const handleEffectDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (isDragPointInsideElement(e, e.currentTarget)) {
      return;
    }

    if (useEffectDropPreviewStore.getState().hoveredItemId !== item.id) {
      return;
    }

    useEffectDropPreviewStore.getState().clearPreview();
  }, [item.id]);

  const handleEffectDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    const rawPayload = e.dataTransfer.getData('application/json');
    let parsedPayload: unknown = getMediaDragData();

    if (rawPayload) {
      try {
        parsedPayload = JSON.parse(rawPayload);
      } catch {
        parsedPayload = getMediaDragData();
      }
    }

    const effects = resolveDirectEffectDropTemplate(parsedPayload);
    const targetItemIds = resolveEffectDropTargets(parsedPayload);
    useEffectDropPreviewStore.getState().clearPreview();

    if (!effects || targetItemIds.length === 0) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    useTrackDropPreviewStore.getState().clearGhostPreviews();
    addEffects(targetItemIds.map((itemId) => ({ itemId, effects })));
    if (targetItemIds.length > 1) {
      toast.success(`Applied effect to ${targetItemIds.length} clips`);
    }
  }, [addEffects, resolveDirectEffectDropTemplate, resolveEffectDropTargets]);

  return {
    handleTransitionCutDragOver,
    handleTransitionCutDragLeave,
    handleTransitionCutDrop,
    handleEffectDragEnter,
    handleEffectDragOver,
    handleEffectDragLeave,
    handleEffectDrop,
  };
}
