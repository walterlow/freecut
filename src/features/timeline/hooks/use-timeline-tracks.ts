import { useCallback } from 'react'
import type { TimelineTrack } from '@/types/timeline'
import { useTimelineStore } from '../stores/timeline-store'
import { getTrackKind } from '@/features/timeline/utils/classic-tracks'
import { isTrackSyncLockActive } from '../utils/track-sync-lock'

function clampTrackVolume(volume: number): number {
  return Math.max(-60, Math.min(12, Math.round(volume * 10) / 10))
}

/**
 * Timeline tracks management hook
 *
 * Uses granular Zustand selectors for optimal performance
 */
export function useTimelineTracks() {
  // Use granular selectors - Zustand v5 best practice
  const tracks = useTimelineStore((s) => s.tracks)
  const setTracks = useTimelineStore((s) => s.setTracks)

  /**
   * Add a new track to the timeline (at the top/beginning)
   * Automatically sets order to be lowest (appears at top after sorting)
   * Reads latest state to avoid stale closure bugs
   */
  const addTrack = useCallback(
    (track: TimelineTrack) => {
      const currentTracks = useTimelineStore.getState().tracks
      // Give it an order lower than all existing tracks
      const minOrder =
        currentTracks.length > 0 ? Math.min(...currentTracks.map((t) => t.order ?? 0)) : 0
      const trackWithOrder = { ...track, order: minOrder - 1 }
      setTracks([trackWithOrder, ...currentTracks])
    },
    [setTracks],
  )

  /**
   * Remove a track by ID
   * Reads latest state to avoid stale closure bugs
   */
  const removeTrack = useCallback(
    (id: string) => {
      const currentTracks = useTimelineStore.getState().tracks
      setTracks(currentTracks.filter((track) => track.id !== id))
    },
    [setTracks],
  )

  /**
   * Remove multiple tracks by IDs
   * Reads latest state to avoid stale closure bugs
   * Uses Set for O(1) lookups instead of O(n) includes()
   */
  const removeTracks = useCallback(
    (ids: string[]) => {
      const currentTracks = useTimelineStore.getState().tracks
      const idsSet = new Set(ids)
      setTracks(currentTracks.filter((track) => !idsSet.has(track.id)))
    },
    [setTracks],
  )

  /**
   * Insert a new track before a specific track ID (so it appears above it)
   * If beforeTrackId is not found or null, inserts at the top
   * Sets the order property so the track sorts correctly
   * Reads latest state to avoid stale closure bugs
   */
  const insertTrack = useCallback(
    (track: TimelineTrack, beforeTrackId: string | null = null) => {
      const currentTracks = useTimelineStore.getState().tracks

      if (!beforeTrackId) {
        // Insert at the top - give it an order lower than all existing tracks
        const minOrder =
          currentTracks.length > 0 ? Math.min(...currentTracks.map((t) => t.order ?? 0)) : 0
        const trackWithOrder = { ...track, order: minOrder - 1 }
        setTracks([trackWithOrder, ...currentTracks])
        return
      }

      const targetIndex = currentTracks.findIndex((t) => t.id === beforeTrackId)
      if (targetIndex === -1) {
        // Track not found, insert at the top
        const minOrder =
          currentTracks.length > 0 ? Math.min(...currentTracks.map((t) => t.order ?? 0)) : 0
        const trackWithOrder = { ...track, order: minOrder - 1 }
        setTracks([trackWithOrder, ...currentTracks])
        return
      }

      // Get the target track's order and the track above it (if any)
      const targetOrder = currentTracks[targetIndex]!.order ?? targetIndex
      const prevOrder =
        targetIndex > 0
          ? (currentTracks[targetIndex - 1]!.order ?? targetIndex - 1)
          : targetOrder - 2 // Default to 2 less than target if no previous track

      // Set order between previous track and target track
      const newOrder = (prevOrder + targetOrder) / 2
      const trackWithOrder = { ...track, order: newOrder }

      const newTracks = [...currentTracks]
      newTracks.splice(targetIndex, 0, trackWithOrder)
      setTracks(newTracks)
    },
    [setTracks],
  )

  /**
   * Update a track's properties
   * Uses getState() to always read latest tracks (avoids stale closure bugs)
   */
  const updateTrack = useCallback(
    (id: string, updates: Partial<TimelineTrack>) => {
      const currentTracks = useTimelineStore.getState().tracks
      setTracks(currentTracks.map((track) => (track.id === id ? { ...track, ...updates } : track)))
    },
    [setTracks],
  )

  /**
   * Reorder tracks based on array of track IDs
   * Reads latest state to avoid stale closure bugs
   */
  const reorderTracks = useCallback(
    (trackIds: string[]) => {
      const currentTracks = useTimelineStore.getState().tracks
      const reordered = trackIds
        .map((id) => currentTracks.find((t) => t.id === id))
        .filter((t): t is TimelineTrack => t !== undefined)
      setTracks(reordered)
    },
    [setTracks],
  )

  const updateExistingTrack = useCallback(
    (id: string, getUpdates: (track: TimelineTrack) => Partial<TimelineTrack>) => {
      const track = useTimelineStore.getState().tracks.find((t) => t.id === id)
      if (!track) return
      updateTrack(id, getUpdates(track))
    },
    [updateTrack],
  )

  /**
   * Toggle track locked state.
   */
  const toggleTrackLock = useCallback(
    (id: string) => {
      updateExistingTrack(id, (track) => ({ locked: !track.locked }))
    },
    [updateExistingTrack],
  )

  /**
   * Toggle track sync lock state.
   */
  const toggleTrackSyncLock = useCallback(
    (id: string) => {
      updateExistingTrack(id, (track) => ({ syncLock: !isTrackSyncLockActive(track) }))
    },
    [updateExistingTrack],
  )

  /**
   * Toggle track visibility.
   */
  const toggleTrackVisibility = useCallback(
    (id: string) => {
      updateExistingTrack(id, (track) => ({ visible: track.visible === false ? true : false }))
    },
    [updateExistingTrack],
  )

  /**
   * Toggle track audio muted state.
   */
  const toggleTrackMute = useCallback(
    (id: string) => {
      updateExistingTrack(id, (track) => ({ muted: !track.muted }))
    },
    [updateExistingTrack],
  )

  /**
   * Toggle the primary disabled state for a track.
   * Video tracks use visibility, audio tracks use mute, and unknown tracks
   * fall back to toggling both to keep the control deterministic.
   */
  const toggleTrackDisabled = useCallback(
    (id: string) => {
      updateExistingTrack(id, (track) => {
        const kind = getTrackKind(track)
        if (kind === 'video') {
          return { visible: track.visible === false ? true : false }
        }
        if (kind === 'audio') {
          return { muted: !track.muted }
        }

        const isDisabled = track.visible === false || track.muted
        return {
          visible: isDisabled,
          muted: !isDisabled,
        }
      })
    },
    [updateExistingTrack],
  )

  /**
   * Toggle track solo state
   * Only one track can be soloed at a time - soloing a track will unsolo all others
   * Reads latest state to avoid stale closure bugs
   */
  const toggleTrackSolo = useCallback(
    (id: string) => {
      const currentTracks = useTimelineStore.getState().tracks
      const targetTrack = currentTracks.find((t) => t.id === id)
      if (!targetTrack) return

      updateTrack(id, { solo: !targetTrack.solo })
    },
    [updateTrack],
  )

  const setTrackVolume = useCallback(
    (id: string, volume: number) => {
      updateTrack(id, { volume: clampTrackVolume(volume) })
    },
    [updateTrack],
  )

  return {
    tracks,
    addTrack,
    removeTrack,
    removeTracks,
    insertTrack,
    updateTrack,
    reorderTracks,
    toggleTrackDisabled,
    toggleTrackLock,
    toggleTrackSyncLock,
    toggleTrackVisibility,
    toggleTrackMute,
    toggleTrackSolo,
    setTrackVolume,
  }
}
