/**
 * Hook for integrating custom Player with timeline playback state
 *
 * Sync strategy:
 * - Timeline seeks trigger Player seeks (both playing and paused)
 * - Player updates are ignored briefly after seeks to prevent loops
 * - Player fires frameupdate → updates timeline scrubber position
 * - Play/pause state is synced bidirectionally
 * - Store is authoritative - if store says paused, Player follows
 */

import { useRef, useEffect, useState, useCallback } from 'react'
import { usePlaybackStore } from '@/shared/state/playback'
import { useTimelineSettingsStore } from '@/features/preview/deps/timeline-store'
import { resolvePreviewTransitionFromPlaybackStates } from '../utils/preview-state-coordinator'
import {
  type PlayerCommand,
  planCurrentFrameSyncCommand,
  planPlaybackStateCommand,
  planPreviewFrameSyncCommand,
} from '../utils/player-command-planner'
import { createLogger } from '@/shared/logging/logger'

const logger = createLogger('useCustomPlayer')
const BACKGROUND_PREVIEW_WARM_SEEK_THROTTLE_MS = 50

export function useCustomPlayer(
  playerRef: React.RefObject<{
    seekTo: (frame: number) => void
    play: () => void
    pause: () => void
    getCurrentFrame: () => number
    isPlaying: () => boolean
  } | null>,
  bypassPreviewSeekRef?: React.RefObject<boolean>,
  preferPlayerForStyledTextScrubRef?: React.RefObject<boolean>,
  isGizmoInteractingRef?: React.RefObject<boolean>,
  onPlayerSeek?: (targetFrame: number) => void,
) {
  const isPlaying = usePlaybackStore((s) => s.isPlaying)

  const [playerReady, setPlayerReady] = useState(false)
  const lastSyncedFrameRef = useRef<number>(0)
  const lastSeekTargetRef = useRef<number | null>(null)
  const lastBackwardScrubSeekAtRef = useRef(0)
  const lastBackwardScrubSeekFrameRef = useRef<number | null>(null)
  const ignorePlayerUpdatesRef = useRef<boolean>(false)
  const wasPlayingRef = useRef(isPlaying)
  const pendingPreviewWarmSeekTargetRef = useRef<number | null>(null)
  const previewWarmSeekTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastPreviewWarmSeekAtRef = useRef<number>(0)

  const getPlayerFrame = useCallback(() => {
    const frame = playerRef.current?.getCurrentFrame()
    return Number.isFinite(frame) ? Math.round(frame!) : null
  }, [playerRef])

  const seekPlayerToFrame = useCallback(
    (targetFrame: number, holdIgnoreUntilReleased = false, forceSameTargetReplay = false) => {
      if (!playerRef.current) return
      const playerFrame = getPlayerFrame()
      if (playerFrame !== null && playerFrame === targetFrame) {
        lastSyncedFrameRef.current = targetFrame
        lastSeekTargetRef.current = targetFrame
        return
      }
      if (
        !forceSameTargetReplay &&
        lastSeekTargetRef.current === targetFrame &&
        ignorePlayerUpdatesRef.current
      ) {
        return
      }

      ignorePlayerUpdatesRef.current = true
      try {
        onPlayerSeek?.(targetFrame)
        playerRef.current.seekTo(targetFrame)
        lastSyncedFrameRef.current = targetFrame
        lastSeekTargetRef.current = targetFrame
      } catch (error) {
        logger.error('Failed to seek Player:', error)
      }

      if (!holdIgnoreUntilReleased) {
        requestAnimationFrame(() => {
          ignorePlayerUpdatesRef.current = false
        })
      }
    },
    [playerRef, getPlayerFrame, onPlayerSeek],
  )

  const clearScheduledPreviewWarmSeek = useCallback(() => {
    pendingPreviewWarmSeekTargetRef.current = null
    if (previewWarmSeekTimerRef.current !== null) {
      clearTimeout(previewWarmSeekTimerRef.current)
      previewWarmSeekTimerRef.current = null
    }
  }, [])

  const flushPreviewWarmSeek = useCallback(() => {
    const targetFrame = pendingPreviewWarmSeekTargetRef.current
    clearScheduledPreviewWarmSeek()
    if (targetFrame === null) {
      return
    }
    lastPreviewWarmSeekAtRef.current = performance.now()
    seekPlayerToFrame(targetFrame)
  }, [clearScheduledPreviewWarmSeek, seekPlayerToFrame])

  const schedulePreviewWarmSeek = useCallback(
    (targetFrame: number) => {
      pendingPreviewWarmSeekTargetRef.current = targetFrame

      const nowMs = performance.now()
      const elapsedMs = nowMs - lastPreviewWarmSeekAtRef.current
      const delayMs = Math.max(0, BACKGROUND_PREVIEW_WARM_SEEK_THROTTLE_MS - elapsedMs)

      if (delayMs === 0 && previewWarmSeekTimerRef.current === null) {
        flushPreviewWarmSeek()
        return
      }

      if (previewWarmSeekTimerRef.current !== null) {
        return
      }

      previewWarmSeekTimerRef.current = setTimeout(() => {
        previewWarmSeekTimerRef.current = null
        flushPreviewWarmSeek()
      }, delayMs)
    },
    [flushPreviewWarmSeek],
  )

  const executePlayerCommand = useCallback(
    (command: PlayerCommand) => {
      if (!playerRef.current) return

      switch (command.type) {
        case 'noop':
          return
        case 'pause':
          playerRef.current.pause()
          return
        case 'play':
          playerRef.current.play()
          return
        case 'seek':
          seekPlayerToFrame(command.targetFrame)
          return
        case 'seek_and_play':
          seekPlayerToFrame(command.targetFrame, true, true)
          if (!usePlaybackStore.getState().isPlaying) {
            ignorePlayerUpdatesRef.current = false
            return
          }
          playerRef.current.play()
          ignorePlayerUpdatesRef.current = false
          return
        default:
          return
      }
    },
    [playerRef, seekPlayerToFrame],
  )

  // Detect when Player becomes ready
  useEffect(() => {
    if (playerRef.current && !playerReady) {
      setPlayerReady(true)
    }
    const checkReady = setInterval(() => {
      if (playerRef.current && !playerReady) {
        setPlayerReady(true)
        clearInterval(checkReady)
      }
    }, 50)

    const timeout = setTimeout(() => clearInterval(checkReady), 1000)

    return () => {
      clearInterval(checkReady)
      clearTimeout(timeout)
    }
  }, [playerRef, playerReady])

  // Timeline → Player: Sync play/pause state
  useEffect(() => {
    if (!playerRef.current) return

    const wasPlaying = wasPlayingRef.current
    wasPlayingRef.current = isPlaying
    const { currentFrame, setPreviewFrame } = usePlaybackStore.getState()
    const playbackPlan = planPlaybackStateCommand({
      wasPlaying,
      isPlaying,
      currentFrame,
      playerFrame: getPlayerFrame(),
    })

    try {
      if (isPlaying && !wasPlaying) {
        flushPreviewWarmSeek()
      }
      if (playbackPlan.clearPreviewFrame) {
        setPreviewFrame(null)
      }
      executePlayerCommand(playbackPlan.command)
    } catch (error) {
      logger.error('Failed to control playback:', error)
    }
  }, [isPlaying, playerRef, executePlayerCommand, flushPreviewWarmSeek, getPlayerFrame])

  // Wait for timeline to finish loading before syncing frame position.
  // Without this, the Player would seek to frame 0 (the default) before
  // loadTimeline() restores the saved currentFrame from IndexedDB.
  const isTimelineLoading = useTimelineSettingsStore((s) => s.isTimelineLoading)

  // Timeline → Player: Sync frame position
  useEffect(() => {
    if (!playerReady || !playerRef.current || isTimelineLoading) return

    const initialFrame = usePlaybackStore.getState().currentFrame
    const playerFrame = getPlayerFrame()
    lastSyncedFrameRef.current = initialFrame
    lastSeekTargetRef.current = initialFrame
    if (playerFrame !== initialFrame) {
      onPlayerSeek?.(initialFrame)
    }
    playerRef.current.seekTo(initialFrame)

    const unsubscribe = usePlaybackStore.subscribe((state, prevState) => {
      if (!playerRef.current) return

      const transition = resolvePreviewTransitionFromPlaybackStates({
        prev: prevState,
        next: state,
        isGizmoInteracting: isGizmoInteractingRef?.current === true,
      })
      const plan = planCurrentFrameSyncCommand({
        transition,
        currentFrame: state.currentFrame,
        lastSyncedFrame: lastSyncedFrameRef.current,
        playerFrame: getPlayerFrame(),
      })

      if (plan.acknowledgedFrame !== null) {
        lastSyncedFrameRef.current = plan.acknowledgedFrame
      }
      if (plan.command.type === 'seek') {
        clearScheduledPreviewWarmSeek()
        seekPlayerToFrame(plan.command.targetFrame)
      }
    })

    return unsubscribe
  }, [
    playerReady,
    isTimelineLoading,
    playerRef,
    clearScheduledPreviewWarmSeek,
    getPlayerFrame,
    seekPlayerToFrame,
    isGizmoInteractingRef,
    onPlayerSeek,
  ])

  // Preview frame seeking: seek to hovered position on timeline
  useEffect(() => {
    if (!playerReady || !playerRef.current) return

    return usePlaybackStore.subscribe((state, prev) => {
      if (!playerRef.current) return
      if (prev.previewFrame !== null && state.previewFrame === null) {
        flushPreviewWarmSeek()
      }
      const transition = resolvePreviewTransitionFromPlaybackStates({
        prev,
        next: state,
        isGizmoInteracting: isGizmoInteractingRef?.current === true,
      })
      const plan = planPreviewFrameSyncCommand({
        transition,
        currentFrame: state.currentFrame,
        previewFrame: state.previewFrame,
        currentFrameEpoch: state.currentFrameEpoch,
        previewFrameEpoch: state.previewFrameEpoch,
        bypassPreviewSeek: bypassPreviewSeekRef?.current === true,
        preferPlayerForStyledTextScrub: preferPlayerForStyledTextScrubRef?.current === true,
        nowMs: performance.now(),
        backwardScrubState: {
          lastSeekAtMs: lastBackwardScrubSeekAtRef.current,
          lastSeekFrame: lastBackwardScrubSeekFrameRef.current,
        },
      })

      lastBackwardScrubSeekAtRef.current = plan.backwardScrubState.lastSeekAtMs
      lastBackwardScrubSeekFrameRef.current = plan.backwardScrubState.lastSeekFrame

      if (plan.command.type === 'seek') {
        if (plan.useBackgroundWarmSeek) {
          schedulePreviewWarmSeek(plan.command.targetFrame)
          return
        }
        clearScheduledPreviewWarmSeek()
        seekPlayerToFrame(plan.command.targetFrame)
        return
      }

      if (!plan.useBackgroundWarmSeek) {
        clearScheduledPreviewWarmSeek()
      }
    })
  }, [
    playerReady,
    playerRef,
    seekPlayerToFrame,
    flushPreviewWarmSeek,
    clearScheduledPreviewWarmSeek,
    schedulePreviewWarmSeek,
    bypassPreviewSeekRef,
    preferPlayerForStyledTextScrubRef,
    isGizmoInteractingRef,
  ])

  useEffect(() => {
    return () => {
      clearScheduledPreviewWarmSeek()
    }
  }, [clearScheduledPreviewWarmSeek])

  return { ignorePlayerUpdatesRef }
}
