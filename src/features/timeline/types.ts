import type { TimelineTrack, TimelineItem, ProjectMarker } from '@/types/timeline';
import type { TransformProperties } from '@/types/transform';
import type { VisualEffect } from '@/types/effects';
import type { Transition, TransitionType, TransitionPresentation, WipeDirection, SlideDirection, FlipDirection, TransitionBreakage } from '@/types/transition';
import type { ItemKeyframes, AnimatableProperty, Keyframe, EasingType, EasingConfig } from '@/types/keyframe';

export interface TimelineState {
  tracks: TimelineTrack[];
  items: TimelineItem[];
  markers: ProjectMarker[];
  transitions: Transition[];
  keyframes: ItemKeyframes[];
  fps: number;
  scrollPosition: number;
  snapEnabled: boolean;
  inPoint: number | null;
  outPoint: number | null;
  isDirty: boolean; // Track unsaved changes
  /** Pending transition breakages to notify user about */
  pendingBreakages: TransitionBreakage[];
}

export interface TimelineActions {
  setTracks: (tracks: TimelineTrack[]) => void;
  // Track group actions
  createGroup: (trackIds: string[]) => void;
  ungroup: (groupTrackId: string) => void;
  toggleGroupCollapse: (groupTrackId: string) => void;
  addToGroup: (trackIds: string[], groupTrackId: string) => void;
  removeFromGroup: (trackIds: string[]) => void;
  addItem: (item: TimelineItem) => void;
  updateItem: (id: string, updates: Partial<TimelineItem>) => void;
  removeItems: (ids: string[]) => void;
  rippleDeleteItems: (ids: string[]) => void;
  closeGapAtPosition: (trackId: string, frame: number) => void;
  closeAllGapsOnTrack: (trackId: string) => void;
  toggleSnap: () => void;
  setScrollPosition: (position: number) => void;
  moveItem: (id: string, newFrom: number, newTrackId?: string) => void;
  moveItems: (updates: Array<{ id: string; from: number; trackId?: string }>) => void;
  duplicateItems: (itemIds: string[], positions: Array<{ from: number; trackId: string }>) => void;
  trimItemStart: (id: string, trimAmount: number) => void;
  trimItemEnd: (id: string, trimAmount: number) => void;
  rollingTrimItems: (leftId: string, rightId: string, editPointDelta: number) => void;
  splitItem: (id: string, splitFrame: number) => void;
  joinItems: (itemIds: string[]) => void;
  rateStretchItem: (id: string, newFrom: number, newDuration: number, newSpeed: number) => void;
  setInPoint: (frame: number) => void;
  setOutPoint: (frame: number) => void;
  clearInOutPoints: () => void;
  // Marker actions
  addMarker: (frame: number, color?: string, label?: string) => void;
  updateMarker: (id: string, updates: Partial<Omit<ProjectMarker, 'id'>>) => void;
  removeMarker: (id: string) => void;
  clearAllMarkers: () => void;
  // Transform actions
  updateItemTransform: (id: string, transform: Partial<TransformProperties>) => void;
  resetItemTransform: (id: string) => void;
  updateItemsTransform: (ids: string[], transform: Partial<TransformProperties>) => void;
  updateItemsTransformMap: (transformsMap: Map<string, Partial<TransformProperties>>) => void;
  // Effect actions
  addEffect: (itemId: string, effect: VisualEffect) => void;
  addEffects: (updates: Array<{ itemId: string; effects: VisualEffect[] }>) => void;
  updateEffect: (itemId: string, effectId: string, updates: Partial<{ effect: VisualEffect; enabled: boolean }>) => void;
  removeEffect: (itemId: string, effectId: string) => void;
  toggleEffect: (itemId: string, effectId: string) => void;
  // Transition actions
  addTransition: (leftClipId: string, rightClipId: string, type?: TransitionType, durationInFrames?: number, presentation?: TransitionPresentation, direction?: WipeDirection | SlideDirection | FlipDirection) => boolean;
  updateTransition: (id: string, updates: Partial<Pick<Transition, 'durationInFrames' | 'type' | 'presentation' | 'direction' | 'timing'>>) => void;
  updateTransitions: (updates: Array<{ id: string; updates: Partial<Pick<Transition, 'durationInFrames' | 'type' | 'presentation' | 'direction' | 'timing'>> }>) => void;
  removeTransition: (id: string) => void;
  /** Clear pending breakages after user has been notified */
  clearPendingBreakages: () => void;
  // Keyframe actions
  addKeyframe: (itemId: string, property: AnimatableProperty, frame: number, value: number, easing?: EasingType) => string;
  addKeyframes: (payloads: Array<{ itemId: string; property: AnimatableProperty; frame: number; value: number; easing?: EasingType; easingConfig?: EasingConfig }>) => string[];
  updateKeyframe: (itemId: string, property: AnimatableProperty, keyframeId: string, updates: Partial<Omit<Keyframe, 'id'>>) => void;
  removeKeyframe: (itemId: string, property: AnimatableProperty, keyframeId: string) => void;
  removeKeyframesForItem: (itemId: string) => void;
  removeKeyframesForProperty: (itemId: string, property: AnimatableProperty) => void;
  getKeyframesForItem: (itemId: string) => ItemKeyframes | undefined;
  hasKeyframesAtFrame: (itemId: string, property: AnimatableProperty, frame: number) => boolean;
  saveTimeline: (projectId: string) => Promise<void>;
  loadTimeline: (projectId: string) => Promise<void>;
  clearTimeline: () => void;
  markDirty: () => void;
  markClean: () => void;
}
