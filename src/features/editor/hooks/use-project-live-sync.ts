import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { Project } from '@/types/project'
import type { MediaMetadata } from '@/types/storage'
import {
  hydrateTimelineStoresFromProject,
  useCompositionNavigationStore,
  useItemsStore,
  useMarkersStore,
  useTimelineSettingsStore,
  useTransitionsStore,
  useZoomStore,
} from '@/features/editor/deps/timeline-store'
import { importFilmstripCache, importWaveformCache } from '@/features/editor/deps/timeline-cache'
import { useMediaLibraryStore } from '@/features/editor/deps/media-library'
import { useProjectStore } from '@/features/editor/deps/projects'
import { clearPreviewAudioCache } from '@/features/editor/deps/composition-runtime'
import { usePlaybackStore } from '@/shared/state/playback'
import { useSelectionStore } from '@/shared/state/selection'
import { blobUrlManager } from '@/infrastructure/browser/blob-url-manager'
import { createLogger } from '@/shared/logging/logger'

const logger = createLogger('ProjectLiveSync')
const DEFAULT_HEADLESS_URL = 'http://127.0.0.1:8787'

interface ProjectSnapshot {
  revision: string
  project: Project
  media: Array<{
    metadata: MediaMetadata
    fingerprint: string
    metadataFingerprint?: string
    sourceFingerprint?: string
    thumbnailFingerprint?: string
  }>
  missingMediaIds: string[]
}

interface UseProjectLiveSyncOptions {
  projectId: string
  isDirty: boolean
  enabled: boolean
}

export function useProjectLiveSync({ projectId, isDirty, enabled }: UseProjectLiveSyncOptions): {
  autoSaveEnabled: boolean
  conflictPending: boolean
  pendingRevision: string | null
  lastAppliedRevision: string | null
  appliedRevisionCount: number
  applyPendingExternal: () => Promise<void>
  keepEditorVersion: () => void
} {
  const dirtyRef = useRef(isDirty)
  dirtyRef.current = isDirty
  const revisionRef = useRef<string | null>(null)
  const contentSignatureRef = useRef<string | null>(null)
  const sourceFingerprintsRef = useRef(new Map<string, string>())
  const queuedSnapshotRef = useRef<ProjectSnapshot | null>(null)
  const conflictPendingRef = useRef(false)
  const applyingRef = useRef(false)
  const refetchAfterApplyRef = useRef(false)
  const scheduleFetchRef = useRef<() => void>(() => undefined)
  const fetchControllerRef = useRef<AbortController | null>(null)
  const scheduleTimerRef = useRef<number | null>(null)
  const [conflictPending, setConflictPending] = useState(false)
  const [pendingRevision, setPendingRevision] = useState<string | null>(null)
  const [lastAppliedRevision, setLastAppliedRevision] = useState<string | null>(null)
  const [appliedRevisionCount, setAppliedRevisionCount] = useState(0)

  useEffect(() => {
    revisionRef.current = null
    contentSignatureRef.current = null
    sourceFingerprintsRef.current = new Map()
    queuedSnapshotRef.current = null
    conflictPendingRef.current = false
    refetchAfterApplyRef.current = false
    setConflictPending(false)
    setPendingRevision(null)
    setLastAppliedRevision(null)
    setAppliedRevisionCount(0)
  }, [projectId])

  const applySnapshot = useCallback(async (snapshot: ProjectSnapshot) => {
    if (applyingRef.current) {
      refetchAfterApplyRef.current = true
      return
    }
    applyingRef.current = true
    const playback = usePlaybackStore.getState()
    const timelineSettings = useTimelineSettingsStore.getState()
    const previousFrame = playback.currentFrame
    const wasPlaying = playback.isPlaying
    const previousZoom = useZoomStore.getState().level
    const previousScroll = timelineSettings.scrollPosition
    const previousSelection = useSelectionStore.getState()
    const previousCompositionPath = useCompositionNavigationStore
      .getState()
      .breadcrumbs.map((breadcrumb) => ({ ...breadcrumb }))

    const mediaItems = snapshot.media.map((entry) => entry.metadata)
    const mediaIds = new Set(mediaItems.map((media) => media.id))
    const nextSourceFingerprints = new Map(
      snapshot.media.map((entry) => [
        entry.metadata.id,
        entry.sourceFingerprint ?? entry.fingerprint,
      ]),
    )
    const changedMediaIds = new Set<string>()
    if (revisionRef.current !== null) {
      for (const [mediaId, fingerprint] of nextSourceFingerprints) {
        if (sourceFingerprintsRef.current.get(mediaId) !== fingerprint) {
          changedMediaIds.add(mediaId)
        }
      }
      for (const mediaId of sourceFingerprintsRef.current.keys()) {
        if (!nextSourceFingerprints.has(mediaId)) changedMediaIds.add(mediaId)
      }
    }

    try {
      playback.pause()
      playback.setPreviewFrame(null)
      timelineSettings.setTimelineLoading(true)

      for (const mediaId of changedMediaIds) blobUrlManager.invalidate(mediaId)
      if (changedMediaIds.size > 0) {
        clearPreviewAudioCache()
        void Promise.all([
          importFilmstripCache().then(({ filmstripCache }) =>
            Promise.all([...changedMediaIds].map((mediaId) => filmstripCache.clearMedia(mediaId))),
          ),
          importWaveformCache().then(({ waveformCache }) =>
            Promise.all([...changedMediaIds].map((mediaId) => waveformCache.clearMedia(mediaId))),
          ),
        ]).catch((error) => logger.warn('Failed to clear changed media caches', error))
      }

      useMediaLibraryStore.setState((state) => ({
        mediaItems,
        mediaById: Object.fromEntries(mediaItems.map((media) => [media.id, media])),
        selectedMediaIds: state.selectedMediaIds.filter((id) => mediaIds.has(id)),
        brokenMediaIds: [...new Set(snapshot.missingMediaIds)],
        isLoading: false,
      }))
      useProjectStore.getState().setCurrentProject(snapshot.project)

      await hydrateTimelineStoresFromProject(snapshot.project)

      restoreCompositionPath(snapshot.project, previousCompositionPath)

      const itemIds = new Set(useItemsStore.getState().items.map((item) => item.id))
      const trackIds = new Set(useItemsStore.getState().tracks.map((track) => track.id))
      const markerIds = new Set(useMarkersStore.getState().markers.map((marker) => marker.id))
      const transitionIds = new Set(
        useTransitionsStore.getState().transitions.map((transition) => transition.id),
      )
      const selectedItems = previousSelection.selectedItemIds.filter((id) => itemIds.has(id))
      const selectedTracks = previousSelection.selectedTrackIds.filter((id) => trackIds.has(id))
      const selection = useSelectionStore.getState()
      if (selectedItems.length > 0) selection.selectItems(selectedItems)
      else if (selectedTracks.length > 0) selection.selectTracks(selectedTracks)
      else if (
        previousSelection.selectedMarkerId &&
        markerIds.has(previousSelection.selectedMarkerId)
      ) {
        selection.selectMarker(previousSelection.selectedMarkerId)
      } else if (
        previousSelection.selectedTransitionId &&
        transitionIds.has(previousSelection.selectedTransitionId)
      ) {
        selection.selectTransition(previousSelection.selectedTransitionId)
      } else {
        selection.clearSelection()
      }

      useZoomStore.getState().setZoomLevelSynchronized(previousZoom)
      useTimelineSettingsStore.getState().setScrollPosition(previousScroll)
      const currentItems = useItemsStore.getState().items
      const maxFrame = Math.max(0, ...currentItems.map((item) => item.from + item.durationInFrames))
      usePlaybackStore.getState().setCurrentFrame(Math.min(previousFrame, maxFrame))
      if (wasPlaying) usePlaybackStore.getState().play()

      contentSignatureRef.current = snapshotContentSignature(snapshot)
      sourceFingerprintsRef.current = nextSourceFingerprints
      revisionRef.current = snapshot.revision
      setLastAppliedRevision(snapshot.revision)
      setAppliedRevisionCount((count) => count + 1)
      queuedSnapshotRef.current = null
      conflictPendingRef.current = false
      setConflictPending(false)
      setPendingRevision(null)
      logger.info('Applied external project revision', {
        projectId: snapshot.project.id,
        revision: snapshot.revision,
        mediaCount: mediaItems.length,
      })
    } finally {
      useTimelineSettingsStore.getState().setTimelineLoading(false)
      applyingRef.current = false
      if (refetchAfterApplyRef.current) {
        refetchAfterApplyRef.current = false
        window.queueMicrotask(() => scheduleFetchRef.current())
      }
    }
  }, [])

  const fetchLatest = useCallback(async () => {
    if (!enabled) return
    fetchControllerRef.current?.abort()
    const controller = new AbortController()
    fetchControllerRef.current = controller
    const baseUrl =
      (import.meta.env.VITE_FREECUT_HEADLESS_URL as string | undefined) ?? DEFAULT_HEADLESS_URL
    try {
      const response = await fetch(
        `${baseUrl}/v1/projects/${encodeURIComponent(projectId)}/snapshot`,
        { signal: controller.signal },
      )
      if (!response.ok) throw new Error(`Snapshot request failed: ${response.status}`)
      const snapshot = (await response.json()) as ProjectSnapshot
      if (snapshot.revision === revisionRef.current) return
      const contentSignature = snapshotContentSignature(snapshot)
      if (contentSignature === contentSignatureRef.current) {
        revisionRef.current = snapshot.revision
        setLastAppliedRevision(snapshot.revision)
        return
      }
      if (dirtyRef.current) {
        queuedSnapshotRef.current = snapshot
        setPendingRevision(snapshot.revision)
        if (!conflictPendingRef.current) {
          conflictPendingRef.current = true
          setConflictPending(true)
          toast.warning('Headless edits are waiting', {
            description:
              'Autosave is paused because this editor has unsaved changes. Save or undo them to apply the external revision safely.',
          })
        }
        return
      }
      await applySnapshot(snapshot)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      logger.debug('Live project snapshot unavailable', {
        projectId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }, [applySnapshot, enabled, projectId])

  const scheduleFetch = useCallback(() => {
    if (scheduleTimerRef.current !== null) window.clearTimeout(scheduleTimerRef.current)
    scheduleTimerRef.current = window.setTimeout(() => {
      scheduleTimerRef.current = null
      void fetchLatest()
    }, 120)
  }, [fetchLatest])
  scheduleFetchRef.current = scheduleFetch

  useEffect(() => {
    if (!enabled) return
    void fetchLatest()

    const baseUrl =
      (import.meta.env.VITE_FREECUT_HEADLESS_URL as string | undefined) ?? DEFAULT_HEADLESS_URL
    const source = new EventSource(
      `${baseUrl}/v1/events?projectId=${encodeURIComponent(projectId)}`,
    )
    source.addEventListener('project.changed', scheduleFetch)
    const onVisible = () => {
      if (document.visibilityState === 'visible') scheduleFetch()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      source.close()
      document.removeEventListener('visibilitychange', onVisible)
      fetchControllerRef.current?.abort()
      if (scheduleTimerRef.current !== null) window.clearTimeout(scheduleTimerRef.current)
    }
  }, [enabled, fetchLatest, projectId, scheduleFetch])

  useEffect(() => {
    if (!enabled || isDirty || !conflictPending) return
    scheduleFetch()
  }, [conflictPending, enabled, isDirty, scheduleFetch])

  const applyPendingExternal = useCallback(async () => {
    const snapshot = queuedSnapshotRef.current
    if (!snapshot) return
    await applySnapshot(snapshot)
  }, [applySnapshot])

  const keepEditorVersion = useCallback(() => {
    queuedSnapshotRef.current = null
    conflictPendingRef.current = false
    setConflictPending(false)
    setPendingRevision(null)
    scheduleFetch()
  }, [scheduleFetch])

  return {
    autoSaveEnabled: !conflictPending,
    conflictPending,
    pendingRevision,
    lastAppliedRevision,
    appliedRevisionCount,
    applyPendingExternal,
    keepEditorVersion,
  }
}

type CompositionBreadcrumbSnapshot = {
  compositionId: string | null
  label: string
  entryItemId?: string
}

function snapshotContentSignature(snapshot: ProjectSnapshot): string {
  const { updatedAt, ...projectWithoutUpdatedAt } = snapshot.project
  void updatedAt
  const timeline = projectWithoutUpdatedAt.timeline
  let project: typeof projectWithoutUpdatedAt = projectWithoutUpdatedAt
  if (timeline) {
    const { currentFrame, scrollPosition, zoomLevel, ...timelineContent } = timeline
    void currentFrame
    void scrollPosition
    void zoomLevel
    project = { ...projectWithoutUpdatedAt, timeline: timelineContent }
  }
  return JSON.stringify({
    project,
    media: snapshot.media.map((entry) => ({
      metadata: entry.metadata,
      sourceFingerprint: entry.sourceFingerprint ?? entry.fingerprint,
      thumbnailFingerprint: entry.thumbnailFingerprint ?? entry.fingerprint,
    })),
    missingMediaIds: [...snapshot.missingMediaIds].sort(),
  })
}

function restoreCompositionPath(
  project: Project,
  previousPath: readonly CompositionBreadcrumbSnapshot[],
): void {
  const root = previousPath[0]
  if (!root) return
  if (root.compositionId) {
    if (!project.timeline?.topLevelSequenceIds?.includes(root.compositionId)) return
    useCompositionNavigationStore.getState().switchToSequence(root.compositionId)
  }

  for (const breadcrumb of previousPath.slice(1)) {
    if (!breadcrumb.compositionId) continue
    const before = useCompositionNavigationStore.getState().activeCompositionId
    useCompositionNavigationStore
      .getState()
      .enterComposition(breadcrumb.compositionId, breadcrumb.label, breadcrumb.entryItemId)
    const active = useCompositionNavigationStore.getState().activeCompositionId
    if (active === before || active !== breadcrumb.compositionId) break
  }
}
