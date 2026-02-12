/**
 * Transition Actions - Cross-fade, wipe, slide, and other transition operations.
 */

import type {
  Transition,
  TransitionType,
  TransitionPresentation,
  WipeDirection,
  SlideDirection,
  FlipDirection,
} from '@/types/transition';
import { useItemsStore } from '../items-store';
import { useTransitionsStore } from '../transitions-store';
import { useTimelineSettingsStore } from '../timeline-settings-store';
import { canAddTransition } from '../../utils/transition-utils';
import { execute, logger } from './shared';

export function addTransition(
  leftClipId: string,
  rightClipId: string,
  type: TransitionType = 'crossfade',
  durationInFrames?: number,
  presentation?: TransitionPresentation,
  direction?: WipeDirection | SlideDirection | FlipDirection
): boolean {
  return execute('ADD_TRANSITION', () => {
    const items = useItemsStore.getState().items;
    const transitions = useTransitionsStore.getState().transitions;
    const fps = useTimelineSettingsStore.getState().fps;

    // Find the clips
    const leftClip = items.find((i) => i.id === leftClipId);
    const rightClip = items.find((i) => i.id === rightClipId);

    if (!leftClip || !rightClip) {
      logger.warn('[addTransition] Clips not found');
      return false;
    }

    const maxByClipDuration = Math.floor(Math.min(leftClip.durationInFrames, rightClip.durationInFrames) - 1);
    if (maxByClipDuration < 1) {
      logger.warn('[addTransition] Cannot add transition: clips are too short');
      return false;
    }

    // Default duration is 1 second (fps frames), but clamp to what both clips can support.
    const requestedDuration = durationInFrames ?? fps;
    const duration = Math.max(1, Math.min(Math.round(requestedDuration), maxByClipDuration));

    // Validate that transition can be added
    const validation = canAddTransition(leftClip, rightClip, duration);
    if (!validation.canAdd) {
      logger.warn('[addTransition] Cannot add transition:', validation.reason);
      return false;
    }

    // Check if transition already exists
    const existingTransition = transitions.find(
      (t) => t.leftClipId === leftClipId && t.rightClipId === rightClipId
    );
    if (existingTransition) {
      logger.warn('[addTransition] Transition already exists between these clips');
      return false;
    }

    useTransitionsStore.getState()._addTransition(
      leftClipId,
      rightClipId,
      leftClip.trackId,
      type,
      duration,
      presentation,
      direction
    );

    useTimelineSettingsStore.getState().markDirty();
    return true;
  }, { leftClipId, rightClipId, type });
}

export function updateTransition(
  id: string,
  updates: Partial<Pick<Transition, 'durationInFrames' | 'type' | 'presentation' | 'direction' | 'timing' | 'alignment' | 'bezierPoints' | 'presetId'>>
): void {
  execute('UPDATE_TRANSITION', () => {
    useTransitionsStore.getState()._updateTransition(id, updates);
    useTimelineSettingsStore.getState().markDirty();
  }, { id, updates });
}

export function updateTransitions(
  updates: Array<{
    id: string;
    updates: Partial<Pick<Transition, 'durationInFrames' | 'type' | 'presentation' | 'direction' | 'timing' | 'alignment' | 'bezierPoints' | 'presetId'>>;
  }>
): void {
  if (updates.length === 0) return;
  execute('UPDATE_TRANSITIONS', () => {
    const store = useTransitionsStore.getState();
    for (const { id, updates: u } of updates) {
      store._updateTransition(id, u);
    }
    useTimelineSettingsStore.getState().markDirty();
  }, { updates });
}

export function removeTransition(id: string): void {
  execute('REMOVE_TRANSITION', () => {
    useTransitionsStore.getState()._removeTransition(id);
    useTimelineSettingsStore.getState().markDirty();
  }, { id });
}

export function clearPendingBreakages(): void {
  // No undo for this - it's ephemeral state
  useTransitionsStore.getState().clearPendingBreakages();
}
