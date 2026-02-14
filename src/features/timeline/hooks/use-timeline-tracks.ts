import { useCallback } from 'react';
import type { TimelineTrack } from '@/types/timeline';
import { useTimelineStore } from '../stores/timeline-store';

/**
 * Timeline tracks management hook
 *
 * Uses granular Zustand selectors for optimal performance
 */
export function useTimelineTracks() {
  // Use granular selectors - Zustand v5 best practice
  const tracks = useTimelineStore((s) => s.tracks);
  const setTracks = useTimelineStore((s) => s.setTracks);

  /**
   * Add a new track to the timeline (at the top/beginning)
   * Automatically sets order to be lowest (appears at top after sorting)
   * Reads latest state to avoid stale closure bugs
   */
  const addTrack = useCallback(
    (track: TimelineTrack) => {
      const currentTracks = useTimelineStore.getState().tracks;
      // Give it an order lower than all existing tracks
      const minOrder = currentTracks.length > 0
        ? Math.min(...currentTracks.map(t => t.order ?? 0))
        : 0;
      const trackWithOrder = { ...track, order: minOrder - 1 };
      setTracks([trackWithOrder, ...currentTracks]);
    },
    [setTracks]
  );

  /**
   * Remove a track by ID
   * Reads latest state to avoid stale closure bugs
   */
  const removeTrack = useCallback(
    (id: string) => {
      const currentTracks = useTimelineStore.getState().tracks;
      setTracks(currentTracks.filter((track) => track.id !== id));
    },
    [setTracks]
  );

  /**
   * Remove multiple tracks by IDs
   * Reads latest state to avoid stale closure bugs
   * Uses Set for O(1) lookups instead of O(n) includes()
   */
  const removeTracks = useCallback(
    (ids: string[]) => {
      const currentTracks = useTimelineStore.getState().tracks;
      const idsSet = new Set(ids);
      setTracks(currentTracks.filter((track) => !idsSet.has(track.id)));
    },
    [setTracks]
  );

  /**
   * Insert a new track before a specific track ID (so it appears above it)
   * If beforeTrackId is not found or null, inserts at the top
   * Sets the order property so the track sorts correctly
   * Reads latest state to avoid stale closure bugs
   */
  const insertTrack = useCallback(
    (track: TimelineTrack, beforeTrackId: string | null = null) => {
      const currentTracks = useTimelineStore.getState().tracks;

      if (!beforeTrackId) {
        // Insert at the top - give it an order lower than all existing tracks
        const minOrder = currentTracks.length > 0
          ? Math.min(...currentTracks.map(t => t.order ?? 0))
          : 0;
        const trackWithOrder = { ...track, order: minOrder - 1 };
        setTracks([trackWithOrder, ...currentTracks]);
        return;
      }

      const targetIndex = currentTracks.findIndex((t) => t.id === beforeTrackId);
      if (targetIndex === -1) {
        // Track not found, insert at the top
        const minOrder = currentTracks.length > 0
          ? Math.min(...currentTracks.map(t => t.order ?? 0))
          : 0;
        const trackWithOrder = { ...track, order: minOrder - 1 };
        setTracks([trackWithOrder, ...currentTracks]);
        return;
      }

      // Get the target track's order and the track above it (if any)
      const targetOrder = currentTracks[targetIndex]!.order ?? targetIndex;
      const prevOrder = targetIndex > 0
        ? (currentTracks[targetIndex - 1]!.order ?? (targetIndex - 1))
        : targetOrder - 2; // Default to 2 less than target if no previous track

      // Set order between previous track and target track
      const newOrder = (prevOrder + targetOrder) / 2;
      const trackWithOrder = { ...track, order: newOrder };

      const newTracks = [...currentTracks];
      newTracks.splice(targetIndex, 0, trackWithOrder);
      setTracks(newTracks);
    },
    [setTracks]
  );

  /**
   * Update a track's properties
   * Uses getState() to always read latest tracks (avoids stale closure bugs)
   */
  const updateTrack = useCallback(
    (id: string, updates: Partial<TimelineTrack>) => {
      const currentTracks = useTimelineStore.getState().tracks;
      setTracks(
        currentTracks.map((track) =>
          track.id === id ? { ...track, ...updates } : track
        )
      );
    },
    [setTracks]
  );

  /**
   * Reorder tracks based on array of track IDs
   * Reads latest state to avoid stale closure bugs
   */
  const reorderTracks = useCallback(
    (trackIds: string[]) => {
      const currentTracks = useTimelineStore.getState().tracks;
      const reordered = trackIds
        .map((id) => currentTracks.find((t) => t.id === id))
        .filter((t): t is TimelineTrack => t !== undefined);
      setTracks(reordered);
    },
    [setTracks]
  );

  /**
   * Toggle track locked state.
   * Group: propagates to all children.
   * Child inside locked group: also unlocks the group.
   */
  const toggleTrackLock = useCallback(
    (id: string) => {
      const currentTracks = useTimelineStore.getState().tracks;
      const track = currentTracks.find((t) => t.id === id);
      if (!track) return;
      const newLocked = !track.locked;

      // Group → set group + all children
      if (track.isGroup) {
        setTracks(
          currentTracks.map((t) => {
            if (t.id === id || t.parentTrackId === id) return { ...t, locked: newLocked };
            return t;
          })
        );
        return;
      }

      // Child unlocking inside locked group → also unlock group
      if (!newLocked && track.parentTrackId) {
        const parent = currentTracks.find((t) => t.id === track.parentTrackId);
        if (parent?.locked) {
          setTracks(
            currentTracks.map((t) => {
              if (t.id === parent.id) return { ...t, locked: false };
              if (t.id === id) return { ...t, locked: false };
              return t;
            })
          );
          return;
        }
      }

      updateTrack(id, { locked: newLocked });
    },
    [updateTrack, setTracks]
  );

  /**
   * Toggle track visibility.
   * Group: propagates to all children.
   * Child showing inside hidden group: also shows the group.
   */
  const toggleTrackVisibility = useCallback(
    (id: string) => {
      const currentTracks = useTimelineStore.getState().tracks;
      const track = currentTracks.find((t) => t.id === id);
      if (!track) return;
      const newVisible = track.visible === false ? true : false;

      // Group → set group + all children
      if (track.isGroup) {
        setTracks(
          currentTracks.map((t) => {
            if (t.id === id || t.parentTrackId === id) return { ...t, visible: newVisible };
            return t;
          })
        );
        return;
      }

      // Child showing inside hidden group → also show group
      if (newVisible && track.parentTrackId) {
        const parent = currentTracks.find((t) => t.id === track.parentTrackId);
        if (parent && !parent.visible) {
          setTracks(
            currentTracks.map((t) => {
              if (t.id === parent.id) return { ...t, visible: true };
              if (t.id === id) return { ...t, visible: true };
              return t;
            })
          );
          return;
        }
      }

      updateTrack(id, { visible: newVisible });
    },
    [updateTrack, setTracks]
  );

  /**
   * Toggle track audio muted state.
   * Group: propagates to all children.
   * Child unmuting inside muted group: also unmutes the group.
   */
  const toggleTrackMute = useCallback(
    (id: string) => {
      const currentTracks = useTimelineStore.getState().tracks;
      const track = currentTracks.find((t) => t.id === id);
      if (!track) return;
      const newMuted = !track.muted;

      // Group → set group + all children
      if (track.isGroup) {
        setTracks(
          currentTracks.map((t) => {
            if (t.id === id || t.parentTrackId === id) return { ...t, muted: newMuted };
            return t;
          })
        );
        return;
      }

      // Child unmuting inside muted group → also unmute group
      if (!newMuted && track.parentTrackId) {
        const parent = currentTracks.find((t) => t.id === track.parentTrackId);
        if (parent?.muted) {
          setTracks(
            currentTracks.map((t) => {
              if (t.id === parent.id) return { ...t, muted: false };
              if (t.id === id) return { ...t, muted: false };
              return t;
            })
          );
          return;
        }
      }

      updateTrack(id, { muted: newMuted });
    },
    [updateTrack, setTracks]
  );

  /**
   * Toggle track solo state
   * Only one track can be soloed at a time - soloing a track will unsolo all others
   * Reads latest state to avoid stale closure bugs
   */
  const toggleTrackSolo = useCallback(
    (id: string) => {
      const currentTracks = useTimelineStore.getState().tracks;
      const targetTrack = currentTracks.find((t) => t.id === id);
      const isCurrentlySolo = targetTrack?.solo;

      // If track is currently solo, just unsolo it
      // If track is not solo, solo it and unsolo all others
      setTracks(
        currentTracks.map((track) => ({
          ...track,
          solo: track.id === id ? !isCurrentlySolo : false,
        }))
      );
    },
    [setTracks]
  );

  // Group actions (delegating to store actions via facade)
  const createGroup = useTimelineStore((s) => s.createGroup);
  const ungroupAction = useTimelineStore((s) => s.ungroup);
  const toggleGroupCollapse = useTimelineStore((s) => s.toggleGroupCollapse);
  const removeFromGroup = useTimelineStore((s) => s.removeFromGroup);

  return {
    tracks,
    addTrack,
    removeTrack,
    removeTracks,
    insertTrack,
    updateTrack,
    reorderTracks,
    toggleTrackLock,
    toggleTrackVisibility,
    toggleTrackMute,
    toggleTrackSolo,
    createGroup,
    ungroup: ungroupAction,
    toggleGroupCollapse,
    removeFromGroup,
  };
}
