import { create } from 'zustand';
import { temporal } from 'zundo';
import type { TimelineState, TimelineActions } from '../types';
import { getProject, updateProject } from '@/lib/storage/indexeddb';
import type { ProjectTimeline } from '@/types/project';
import { usePlaybackStore } from '@/features/preview/stores/playback-store';
import { useZoomStore } from './zoom-store';

// IMPORTANT: Always use granular selectors to prevent unnecessary re-renders!
//
// ✅ CORRECT: Use granular selectors
// const currentFrame = useTimelineStore(s => s.currentFrame);
// const setCurrentFrame = useTimelineStore(s => s.setCurrentFrame);
//
// ❌ WRONG: Don't destructure the entire store
// const { currentFrame, setCurrentFrame } = useTimelineStore();
//
// UNDO/REDO: This store is wrapped with Zundo's temporal middleware
// Access undo/redo functionality:
// const undo = useTimelineStore.temporal.getState().undo;
// const redo = useTimelineStore.temporal.getState().redo;
// const canUndo = useTimelineStore((state) => state.pastStates.length > 0);

export const useTimelineStore = create<TimelineState & TimelineActions>()(
  temporal((set) => ({
  // State
  tracks: [],
  items: [],
  fps: 30,
  scrollPosition: 0,
  snapEnabled: true,
  inPoint: null,
  outPoint: null,

  // Actions
  setTracks: (tracks) => set({ tracks }),
  addItem: (item) => set((state) => ({ items: [...state.items, item as any] })),
  updateItem: (id, updates) => set((state) => ({
    items: state.items.map((i) => (i.id === id ? { ...i, ...updates } : i)),
  })),
  removeItems: (ids) => set((state) => ({
    items: state.items.filter((i) => !ids.includes(i.id)),
  })),
  toggleSnap: () => set((state) => ({ snapEnabled: !state.snapEnabled })),
  moveItem: (id, newFrom, newTrackId) => set((state) => ({
    items: state.items.map((i) =>
      i.id === id
        ? { ...i, from: newFrom, ...(newTrackId && { trackId: newTrackId }) }
        : i
    ),
  })),
  moveItems: (updates) => set((state) => {
    const updateMap = new Map(updates.map((u) => [u.id, u]));
    return {
      items: state.items.map((i) => {
        const update = updateMap.get(i.id);
        return update
          ? { ...i, from: update.from, ...(update.trackId && { trackId: update.trackId }) }
          : i;
      }),
    };
  }),

  // Trim item from start: increases trimStart and sourceStart, adjusts from position
  trimItemStart: (id, trimAmount) => set((state) => ({
    items: state.items.map((item) => {
      if (item.id !== id) return item;

      const currentTrimStart = item.trimStart || 0;
      const currentSourceStart = item.sourceStart || 0;
      const sourceDuration = item.sourceDuration || item.durationInFrames;

      // Calculate new values with boundary checks
      let actualTrimAmount = trimAmount;

      // Prevent extending before source start (sourceStart + trimAmount < 0)
      if (trimAmount < 0 && currentSourceStart + trimAmount < 0) {
        actualTrimAmount = -currentSourceStart;
      }

      // Prevent trimming more than available duration
      if (trimAmount > 0 && item.durationInFrames - trimAmount < 1) {
        actualTrimAmount = item.durationInFrames - 1;
      }

      // Ensure we don't exceed source duration when extending
      // (This shouldn't happen with proper initialization, but keep as safeguard)
      const _ = sourceDuration; // Mark as used

      const newTrimStart = Math.max(0, currentTrimStart + actualTrimAmount);
      const newSourceStart = currentSourceStart + actualTrimAmount;
      const newDuration = Math.max(1, item.durationInFrames - actualTrimAmount);
      const newFrom = item.from + actualTrimAmount;

      // Update offset for Remotion compatibility (offset = trimStart)
      const updates: Partial<typeof item> = {
        trimStart: newTrimStart,
        sourceStart: newSourceStart,
        durationInFrames: newDuration,
        from: newFrom,
      };

      // Add offset for video/audio items (Remotion compatibility)
      if (item.type === 'video' || item.type === 'audio') {
        (updates as any).offset = newTrimStart;
      }

      return { ...item, ...updates };
    }),
  })),

  // Trim item from end: increases trimEnd and adjusts duration
  trimItemEnd: (id, trimAmount) => set((state) => ({
    items: state.items.map((item) => {
      if (item.id !== id) return item;

      const currentTrimEnd = item.trimEnd || 0;
      const sourceDuration = item.sourceDuration || item.durationInFrames;
      const currentSourceEnd = item.sourceEnd || sourceDuration;

      // Calculate new values with boundary checks
      let actualTrimAmount = trimAmount;

      // Prevent extending beyond source duration (sourceEnd + trimAmount > sourceDuration)
      if (trimAmount < 0 && currentSourceEnd - trimAmount > sourceDuration) {
        actualTrimAmount = -(sourceDuration - currentSourceEnd);
      }

      // Prevent trimming more than available duration
      if (trimAmount > 0 && item.durationInFrames - trimAmount < 1) {
        actualTrimAmount = item.durationInFrames - 1;
      }

      const newTrimEnd = Math.max(0, currentTrimEnd + actualTrimAmount);
      const newSourceEnd = currentSourceEnd - actualTrimAmount;
      const newDuration = Math.max(1, item.durationInFrames - actualTrimAmount);

      return {
        ...item,
        trimEnd: newTrimEnd,
        sourceEnd: newSourceEnd,
        durationInFrames: newDuration,
      };
    }),
  })),

  // Split item at the specified frame
  splitItem: (id, splitFrame) => set((state) => {
    const item = state.items.find((i) => i.id === id);
    if (!item) return state;

    // Validate split position is within item bounds
    if (splitFrame <= item.from || splitFrame >= item.from + item.durationInFrames) {
      console.warn('Split frame must be within item bounds');
      return state;
    }

    // Calculate durations for left and right items
    const leftDuration = splitFrame - item.from;
    const rightDuration = item.from + item.durationInFrames - splitFrame;

    // Ensure minimum duration of 1 frame
    if (leftDuration < 1 || rightDuration < 1) {
      console.warn('Split would create item with less than 1 frame duration');
      return state;
    }

    // Create base properties for both items
    const currentTrimStart = item.trimStart || 0;
    const currentSourceStart = item.sourceStart || 0;
    const currentTrimEnd = item.trimEnd || 0;

    // Left item: keeps original from, new duration, updated end trim
    const leftItem: typeof item = {
      ...item,
      id: crypto.randomUUID(),
      durationInFrames: leftDuration,
      // Update sourceEnd and trimEnd for left item
      sourceEnd: currentSourceStart + leftDuration,
      trimEnd: currentTrimEnd + rightDuration,
    };

    // Right item: new from, new duration, adjusted trim properties
    const rightItem: typeof item = {
      ...item,
      id: crypto.randomUUID(),
      from: splitFrame,
      durationInFrames: rightDuration,
      // Adjust trim/source properties to account for split
      trimStart: currentTrimStart + leftDuration,
      sourceStart: currentSourceStart + leftDuration,
    };

    // Update offset for video/audio items (Remotion compatibility)
    if (item.type === 'video' || item.type === 'audio') {
      (leftItem as any).offset = leftItem.trimStart || 0;
      (rightItem as any).offset = rightItem.trimStart || 0;
    }

    // Replace original item with the two new items
    return {
      items: state.items
        .filter((i) => i.id !== id)
        .concat([leftItem, rightItem]),
    };
  }),

  // In/Out point actions with validation
  setInPoint: (frame) => set((state) => {
    // Calculate last frame from rightmost item
    const maxEndFrame = state.items.length > 0
      ? Math.max(...state.items.map(item => item.from + item.durationInFrames))
      : state.fps * 10; // Default to 10 seconds if no items

    // If out-point doesn't exist, set it to the last frame
    if (state.outPoint === null) {
      return { inPoint: frame, outPoint: Math.max(maxEndFrame, frame + 1) };
    }

    // If out-point exists and in-point would exceed it, move out-point to last frame
    if (frame >= state.outPoint) {
      return { inPoint: frame, outPoint: Math.max(maxEndFrame, frame + 1) };
    }
    return { inPoint: frame };
  }),
  setOutPoint: (frame) => set((state) => {
    // If in-point doesn't exist, set it to frame 0
    if (state.inPoint === null) {
      return { inPoint: 0, outPoint: frame };
    }

    // If in-point exists and out-point would go before it, move in-point to frame 0
    if (frame <= state.inPoint) {
      return { inPoint: 0, outPoint: frame };
    }
    return { outPoint: frame };
  }),
  clearInOutPoints: () => set({ inPoint: null, outPoint: null }),

  // Save timeline to project in IndexedDB
  saveTimeline: async (projectId) => {
    const state = useTimelineStore.getState();
    const currentFrame = usePlaybackStore.getState().currentFrame;
    const zoomLevel = useZoomStore.getState().level;

    try {
      // Get the current project
      const project = await getProject(projectId);
      if (!project) {
        throw new Error(`Project not found: ${projectId}`);
      }

      // Prepare timeline data (serialize tracks without items since items are separate)
      const timelineData: ProjectTimeline = {
        tracks: state.tracks.map(track => ({
          id: track.id,
          name: track.name,
          height: track.height,
          locked: track.locked,
          visible: track.visible,
          muted: track.muted,
          solo: track.solo,
          color: track.color,
          order: track.order,
        })),
        items: state.items.map(item => {
          // Base properties common to all items
          const baseItem = {
            id: item.id,
            trackId: item.trackId,
            from: item.from,
            durationInFrames: item.durationInFrames,
            label: item.label,
            mediaId: item.mediaId,
            originId: item.originId, // Stable key lineage tracking
            type: item.type,
            // Save trim properties for all items
            ...(item.trimStart !== undefined && { trimStart: item.trimStart }),
            ...(item.trimEnd !== undefined && { trimEnd: item.trimEnd }),
            ...(item.sourceStart !== undefined && { sourceStart: item.sourceStart }),
            ...(item.sourceEnd !== undefined && { sourceEnd: item.sourceEnd }),
            ...(item.sourceDuration !== undefined && { sourceDuration: item.sourceDuration }),
          };

          // Add type-specific properties
          if (item.type === 'video') {
            return { ...baseItem, src: item.src, thumbnailUrl: item.thumbnailUrl, offset: item.offset };
          } else if (item.type === 'audio') {
            return { ...baseItem, src: item.src, waveformData: item.waveformData, offset: item.offset };
          } else if (item.type === 'text') {
            return { ...baseItem, text: item.text, fontSize: item.fontSize, fontFamily: item.fontFamily, color: item.color };
          } else if (item.type === 'image') {
            return { ...baseItem, src: item.src, thumbnailUrl: item.thumbnailUrl };
          } else if (item.type === 'shape') {
            return { ...baseItem, shapeType: item.shapeType, fillColor: item.fillColor };
          }
          return baseItem as any;
        }),
        // Save playback and view state
        currentFrame,
        zoomLevel,
        // Save in/out points
        ...(state.inPoint !== null && { inPoint: state.inPoint }),
        ...(state.outPoint !== null && { outPoint: state.outPoint }),
      };

      // Update project with timeline data
      await updateProject(projectId, {
        timeline: timelineData,
      });
    } catch (error) {
      console.error('Failed to save timeline:', error);
      throw error;
    }
  },

  // Load timeline from project in IndexedDB
  loadTimeline: async (projectId) => {
    try {
      const project = await getProject(projectId);
      if (!project) {
        throw new Error(`Project not found: ${projectId}`);
      }

      if (project.timeline) {
        // Restore tracks and items from project
        set({
          tracks: project.timeline.tracks.map(track => ({
            ...track,
            items: [], // Items are stored separately
          })),
          items: project.timeline.items as any, // Type assertion needed due to serialization
          // Restore in/out points
          inPoint: project.timeline.inPoint ?? null,
          outPoint: project.timeline.outPoint ?? null,
        });

        // Restore playback and view state
        if (project.timeline.currentFrame !== undefined) {
          usePlaybackStore.getState().setCurrentFrame(project.timeline.currentFrame);
        }
        if (project.timeline.zoomLevel !== undefined) {
          useZoomStore.getState().setZoomLevel(project.timeline.zoomLevel);
        }
      } else {
        // Initialize with empty state for new projects
        set({
          tracks: [],
          items: [],
        });

        // Reset playback and view state for new projects
        usePlaybackStore.getState().setCurrentFrame(0);
        useZoomStore.getState().setZoomLevel(1);
      }
    } catch (error) {
      console.error('Failed to load timeline:', error);
      throw error;
    }
  },

  // Clear timeline (reset to empty state)
  clearTimeline: () => set({
    tracks: [],
    items: [],
    scrollPosition: 0,
  }),
  }))
);
