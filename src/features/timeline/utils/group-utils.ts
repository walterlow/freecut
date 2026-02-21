/**
 * Track Group Utilities
 *
 * Pure functions for querying and manipulating track group hierarchy.
 * Groups are container tracks that organize children. Group-level mute/visible/locked
 * gates propagate to child tracks via resolveEffectiveTrackStates().
 */

import type { TimelineTrack, TimelineItem } from '@/types/timeline';

/**
 * Get ordered child tracks of a group track.
 * Returns children sorted by their `order` property.
 */
export function getChildTracks(tracks: TimelineTrack[], parentId: string): TimelineTrack[] {
  return tracks
    .filter((t) => t.parentTrackId === parentId)
    .sort((a, b) => a.order - b.order);
}

/**
 * Get the parent group track for a given track.
 * Returns undefined if the track is top-level (not in any group).
 */
export function getGroupTrack(tracks: TimelineTrack[], trackId: string): TimelineTrack | undefined {
  const track = tracks.find((t) => t.id === trackId);
  if (!track?.parentTrackId) return undefined;
  return tracks.find((t) => t.id === track.parentTrackId);
}

/**
 * Check if a track belongs to a group.
 */
export function isTrackInGroup(track: TimelineTrack): boolean {
  return !!track.parentTrackId;
}

/**
 * Check if a track is a group container.
 */
export function isGroupTrack(track: TimelineTrack): boolean {
  return !!track.isGroup;
}

/**
 * Get all tracks that should be visible in the timeline UI.
 * Filters out children of collapsed group tracks.
 */
export function getVisibleTracks(tracks: TimelineTrack[]): TimelineTrack[] {
  // Collect IDs of all collapsed groups
  const collapsedGroupIds = new Set(
    tracks.filter((t) => t.isGroup && t.isCollapsed).map((t) => t.id)
  );

  if (collapsedGroupIds.size === 0) return tracks;

  return tracks.filter((t) => {
    // Show the track if it has no parent, or its parent is not collapsed
    return !t.parentTrackId || !collapsedGroupIds.has(t.parentTrackId);
  });
}

/**
 * Build a set of track IDs whose items should contribute snap targets.
 * Excludes: group tracks (hold no items), hidden tracks, children of
 * collapsed or hidden groups.
 */
export function getVisibleTrackIds(tracks: TimelineTrack[]): Set<string> {
  const ids = new Set<string>();

  const groupById = new Map<string, { visible: boolean; collapsed: boolean }>();
  for (const t of tracks) {
    if (t.isGroup) {
      groupById.set(t.id, { visible: t.visible !== false, collapsed: !!t.isCollapsed });
    }
  }

  for (const t of tracks) {
    if (t.isGroup) continue;
    if (t.visible === false) continue;
    if (t.parentTrackId) {
      const parent = groupById.get(t.parentTrackId);
      if (parent && (parent.collapsed || !parent.visible)) continue;
    }
    ids.add(t.id);
  }

  return ids;
}

/**
 * Get the nesting depth of a track (0 = top-level, 1 = inside a group).
 * Currently capped at 1 level of nesting.
 */
export function getGroupDepth(tracks: TimelineTrack[], trackId: string): number {
  const track = tracks.find((t) => t.id === trackId);
  if (!track?.parentTrackId) return 0;
  return 1; // Capped at 1 level for now
}

/**
 * Get the merged frame range for a collapsed group's summary bar.
 * Returns a single { from, to } spanning all child items, or null if no items.
 */
export function getGroupCoverageRange(
  items: TimelineItem[],
  childTrackIds: Set<string>
): { from: number; to: number } | null {
  let min = Infinity;
  let max = -Infinity;
  for (const item of items) {
    if (!childTrackIds.has(item.trackId)) continue;
    min = Math.min(min, item.from);
    max = Math.max(max, item.from + item.durationInFrames);
  }
  if (min === Infinity) return null;
  return { from: min, to: max };
}

/**
 * Get all child track IDs for a group (non-recursive — direct children only).
 */
export function getChildTrackIds(tracks: TimelineTrack[], groupId: string): string[] {
  return tracks.filter((t) => t.parentTrackId === groupId).map((t) => t.id);
}

/**
 * Check if all provided track IDs share the same parent group (or are all top-level).
 */
export function tracksShareSameParent(tracks: TimelineTrack[], trackIds: string[]): boolean {
  const targetTracks = tracks.filter((t) => trackIds.includes(t.id));
  if (targetTracks.length === 0) return true;
  const firstParent = targetTracks[0]?.parentTrackId ?? null;
  return targetTracks.every((t) => (t.parentTrackId ?? null) === firstParent);
}

/**
 * Resolve effective track states by applying parent group gate behavior.
 *
 * When a group track has `visible: false`, all children are effectively hidden.
 * When a group track has `muted: true`, all children are effectively muted.
 * When a group track has `locked: true`, all children are effectively locked.
 *
 * Returns a new array with overridden values — original tracks are not mutated.
 * Group container tracks (isGroup: true) are excluded from the result since they
 * hold no items and should not be rendered.
 */
export function resolveEffectiveTrackStates(tracks: TimelineTrack[]): TimelineTrack[] {
  // Build a lookup of group tracks by ID
  const groupById = new Map<string, TimelineTrack>();
  for (const t of tracks) {
    if (t.isGroup) {
      groupById.set(t.id, t);
    }
  }

  // No groups → return non-group tracks unchanged
  if (groupById.size === 0) return tracks;

  return tracks
    .filter((t) => !t.isGroup) // Exclude group containers (they have no items)
    .map((t) => {
      if (!t.parentTrackId) return t; // Top-level track, no gating

      const parent = groupById.get(t.parentTrackId);
      if (!parent) return t; // Orphaned reference, no gating

      const needsMuteGate = parent.muted && !t.muted;
      const needsHideGate = !parent.visible && t.visible !== false;
      const needsLockGate = parent.locked && !t.locked;

      if (!needsMuteGate && !needsHideGate && !needsLockGate) return t;

      return {
        ...t,
        ...(needsMuteGate && { muted: true }),
        ...(needsHideGate && { visible: false }),
        ...(needsLockGate && { locked: true }),
      };
    });
}
