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
  projectRevision: string
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

function isActiveProjectGeneration(isMounted: boolean, current: object, expected: object): boolean {
  return isMounted && current === expected
}

function queueRefetchAfterApply(
  isActive: boolean,
  refetchAfterApplyRef: { current: boolean },
  scheduleFetchRef: { current: () => void },
): void {
  if (!isActive || !refetchAfterApplyRef.current) return
  refetchAfterApplyRef.current = false
  window.queueMicrotask(() => scheduleFetchRef.current())
}

async function requestProjectSnapshot(
  baseUrl: string,
  projectId: string,
  controller: AbortController,
  isMounted: () => boolean,
): Promise<ProjectSnapshot | null> {
  const response = await fetch(`${baseUrl}/v1/projects/${encodeURIComponent(projectId)}/snapshot`, {
    signal: controller.signal,
  })
  if (controller.signal.aborted || !isMounted()) return null
  if (!response.ok) throw new Error(`Snapshot request failed: ${response.status}`)
  const snapshot = (await response.json()) as ProjectSnapshot
  return controller.signal.aborted || !isMounted() ? null : snapshot
}

function isAbortedSnapshotRequest(error: unknown, controller: AbortController): boolean {
  return controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')
}

export function useProjectLiveSync({ projectId, isDirty, enabled }: UseProjectLiveSyncOptions): {
  autoSaveEnabled: boolean
  conflictPending: boolean
  pendingRevision: string | null
  lastAppliedRevision: string | null
  appliedRevisionCount: number
  applyPendingExternal: () => Promise<void>
  publishEditorVersion: (project: Project, persistLocal: () => Promise<void>) => Promise<void>
} {
  const dirtyRef = useRef(isDirty)
  dirtyRef.current = isDirty
  const revisionRef = useRef<string | null>(null)
  const contentSignatureRef = useRef<string | null>(null)
  const sourceFingerprintsRef = useRef(new Map<string, string>())
  const queuedSnapshotRef = useRef<ProjectSnapshot | null>(null)
  const conflictPendingRef = useRef(false)
  const applyingRef = useRef(false)
  const publishingRef = useRef(false)
  const isMountedRef = useRef(true)
  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])
  const projectGenerationRef = useRef({ projectId, generation: 0 })
  if (projectGenerationRef.current.projectId !== projectId) {
    projectGenerationRef.current = {
      projectId,
      generation: projectGenerationRef.current.generation + 1,
    }
  }
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
    const generation = projectGenerationRef.current
    const isCurrentProjectGeneration = () =>
      isActiveProjectGeneration(isMountedRef.current, projectGenerationRef.current, generation)
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
      if (!isCurrentProjectGeneration()) return
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

      await hydrateTimelineStoresFromProject(snapshot.project, {
        shouldApply: isCurrentProjectGeneration,
      })
      if (!isCurrentProjectGeneration()) return

      useMediaLibraryStore.setState((state) => ({
        mediaItems,
        mediaById: Object.fromEntries(mediaItems.map((media) => [media.id, media])),
        selectedMediaIds: state.selectedMediaIds.filter((id) => mediaIds.has(id)),
        brokenMediaIds: [...new Set(snapshot.missingMediaIds)],
        isLoading: false,
      }))
      useProjectStore.getState().setCurrentProject(snapshot.project)
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
      if (isCurrentProjectGeneration()) {
        useTimelineSettingsStore.getState().setTimelineLoading(false)
      }
      applyingRef.current = false
      queueRefetchAfterApply(isCurrentProjectGeneration(), refetchAfterApplyRef, scheduleFetchRef)
    }
  }, [])

  const fetchLatest = useCallback(async () => {
    if (!enabled || publishingRef.current) return
    fetchControllerRef.current?.abort()
    const controller = new AbortController()
    fetchControllerRef.current = controller
    const baseUrl =
      (import.meta.env.VITE_FREECUT_HEADLESS_URL as string | undefined) ?? DEFAULT_HEADLESS_URL
    try {
      const snapshot = await requestProjectSnapshot(
        baseUrl,
        projectId,
        controller,
        () => isMountedRef.current,
      )
      if (!snapshot) return
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
      if (isAbortedSnapshotRequest(error, controller)) return
      logger.debug('Live project snapshot unavailable', {
        projectId,
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      if (fetchControllerRef.current === controller) fetchControllerRef.current = null
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

  const publishEditorVersion = useCallback(
    async (project: Project, persistLocal: () => Promise<void>) => {
      const snapshot = queuedSnapshotRef.current
      if (!snapshot) throw new Error('No external project revision is waiting')
      publishingRef.current = true
      fetchControllerRef.current?.abort()
      fetchControllerRef.current = null
      let completed = false
      try {
        const baseUrl =
          (import.meta.env.VITE_FREECUT_HEADLESS_URL as string | undefined) ?? DEFAULT_HEADLESS_URL
        const response = await fetch(`${baseUrl}/v1/projects/${encodeURIComponent(projectId)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            project,
            expectedRevision: snapshot.projectRevision,
          }),
        })
        if (!response.ok) {
          throw new Error(`Headless project save failed: ${response.status}`)
        }
        const saved = (await response.json()) as { revision?: string }
        if (saved.revision && queuedSnapshotRef.current) {
          queuedSnapshotRef.current = {
            ...queuedSnapshotRef.current,
            projectRevision: saved.revision,
          }
        }
        await persistLocal()
        dirtyRef.current = false
        queuedSnapshotRef.current = null
        conflictPendingRef.current = false
        setConflictPending(false)
        setPendingRevision(null)
        completed = true
      } finally {
        publishingRef.current = false
      }
      if (completed) scheduleFetch()
    },
    [projectId, scheduleFetch],
  )

  return {
    autoSaveEnabled: !conflictPending,
    conflictPending,
    pendingRevision,
    lastAppliedRevision,
    appliedRevisionCount,
    applyPendingExternal,
    publishEditorVersion,
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
