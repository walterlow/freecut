import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import {
  useTimelineStore,
  useItemsStore,
  useCompositionsStore,
  useTimelineCommandStore,
  captureSnapshot,
  importWaveformCache,
} from '@/features/editor/deps/timeline-store'
import { useGizmoStore } from '@/features/editor/deps/preview'
import { importMediaLibraryService } from '@/features/editor/deps/media-library'
import { getResolvedPlaybackFrame, usePlaybackStore } from '@/shared/state/playback'
import { usePreviewBridgeStore } from '@/shared/state/preview-bridge'
import { useEditorStore } from '@/app/state/editor/store'
import { EDITOR_LAYOUT_CSS_VALUES } from '@/app/editor-layout'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { FloatingPanel } from '@/components/ui/floating-panel'
import { WindowPortal } from '@/components/ui/window-portal'
import { Check, MoreHorizontal } from 'lucide-react'
import {
  AUDIO_METER_SCALE_MARKS,
  compileAudioMeterGraph,
  dbMarkToPercent,
  estimateAudioMeterLevel,
  estimatePerTrackLevels,
  formatMeterDb,
  isAudioMixerTrack,
  linearLevelToPercent,
  getLiveBusVolumeOverride,
  getLiveOverrideVersion,
  subscribeLiveOverrideVersion,
  resolveCompiledAudioMeterSources,
  type AudioMeterCompositionLookup,
  type AudioMeterEstimate,
  type AudioMeterWaveform,
} from './audio-meter-utils'
import { AudioMixerView, type AudioMixerTrack } from './audio-mixer-view'
import { AudioEqPanelContent } from './properties-sidebar/clip-panel/audio-eq-panel-content'
import { type AudioEqPatch } from './properties-sidebar/clip-panel/audio-eq-curve-editor'
import { getSparseAudioEqSettings } from '@/shared/utils/audio-eq'
import { type AudioEqSettings } from '@/types/audio'
import { clearMixerLiveGainLayer, setMixerLiveGainLayer } from '@/shared/state/mixer-live-gain'

type PanelMode = 'meter' | 'mixer'
type EqPanelTarget = { kind: 'track'; trackId: string } | { kind: 'bus' }
type EqPanelDescriptor =
  | {
      title: string
      targetLabel: string
      trackId: string
      trackEq: AudioEqSettings | undefined
      eqEnabled: boolean
    }
  | {
      title: string
      targetLabel: string
      busEq: AudioEqSettings | undefined
      eqEnabled: boolean
    }
const MUTE_SOLO_LIVE_GAIN_LAYER_ID = 'track-mute-solo'

function toWaveformSnapshot(
  waveform:
    | { peaks: Float32Array; sampleRate: number; channels?: number; stereo?: boolean }
    | null
    | undefined,
): AudioMeterWaveform | null {
  if (!waveform) {
    return null
  }

  return {
    peaks: waveform.peaks,
    sampleRate: waveform.sampleRate,
    channels: waveform.stereo ? 2 : (waveform.channels ?? 1),
  }
}

function animateChannel(
  channel: { displayPercent: number; peakPercent: number; peakHoldSeconds: number },
  targetPercent: number,
  deltaSeconds: number,
): void {
  if (targetPercent >= channel.displayPercent) {
    const attackFactor = 1 - Math.exp(-28 * deltaSeconds)
    channel.displayPercent += (targetPercent - channel.displayPercent) * attackFactor
  } else {
    channel.displayPercent = Math.max(targetPercent, channel.displayPercent - 76 * deltaSeconds)
  }

  if (channel.displayPercent >= channel.peakPercent) {
    channel.peakPercent = channel.displayPercent
    channel.peakHoldSeconds = 0.22
  } else if (channel.peakHoldSeconds > 0) {
    channel.peakHoldSeconds = Math.max(0, channel.peakHoldSeconds - deltaSeconds)
  } else {
    channel.peakPercent = Math.max(channel.displayPercent, channel.peakPercent - 54 * deltaSeconds)
  }
}

const EMPTY_PER_TRACK_LEVELS = new Map<string, AudioMeterEstimate>()

const FLOATING_MIXER_STORAGE_KEY = 'editor:floatingMixerBounds'
const FLOATING_MIXER_DEFAULT_BOUNDS = { x: -1, y: -1, width: 420, height: 500 }
const DETACHED_EQ_STORAGE_KEY = 'editor:detachedEqPos'
const DETACHED_EQ_DEFAULT_BOUNDS = {
  width: 780,
  height: 660,
}

interface AudioEqPanelSurfaceProps {
  targetLabel: string
  trackEq?: AudioEqSettings
  enabled: boolean
  onTrackEqChange?: (patch: AudioEqPatch) => void
  onEnabledChange?: (enabled: boolean) => void
  layoutMode?: 'floating' | 'detached'
}

const AudioEqPanelSurface = memo(function AudioEqPanelSurface({
  targetLabel,
  trackEq,
  enabled,
  onTrackEqChange,
  onEnabledChange,
  layoutMode = 'floating',
}: AudioEqPanelSurfaceProps) {
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null)

  const handleRootRef = useCallback((node: HTMLDivElement | null) => {
    setPortalContainer(node?.ownerDocument.body ?? null)
  }, [])

  return (
    <div ref={handleRootRef} className="bg-background text-foreground">
      <AudioEqPanelContent
        targetLabel={targetLabel}
        trackEq={trackEq}
        enabled={enabled}
        onTrackEqChange={onTrackEqChange}
        onEnabledChange={onEnabledChange}
        portalContainer={portalContainer}
        layoutMode={layoutMode}
      />
    </div>
  )
})

export const AudioMeterPanel = memo(function AudioMeterPanel() {
  const [panelMode, setPanelMode] = useState<PanelMode>('meter')
  const [eqPanelTarget, setEqPanelTarget] = useState<EqPanelTarget | null>(null)
  const mixerFloating = useEditorStore((s) => s.mixerFloating)
  const setMixerFloating = useEditorStore((s) => s.setMixerFloating)
  const [trackSnapshotVersion, setTrackSnapshotVersion] = useState(0)
  const eqDetachedWindowRef = useRef<Window | null>(null)

  const tracks = useTimelineStore((s) => s.tracks)
  const transitions = useTimelineStore((s) => s.transitions)
  const fps = useTimelineStore((s) => s.fps)
  const itemsByTrackId = useItemsStore((s) => s.itemsByTrackId)
  const compositions = useCompositionsStore((s) => s.compositions)

  const currentFrame = usePlaybackStore((s) => s.currentFrame)
  const displayedFrame = usePreviewBridgeStore((s) => s.displayedFrame)
  const previewFrame = usePlaybackStore((s) => s.previewFrame)
  const isPlaying = usePlaybackStore((s) => s.isPlaying)
  const masterBusDb = usePlaybackStore((s) => s.masterBusDb)
  const setMasterBusDb = usePlaybackStore((s) => s.setMasterBusDb)
  // Monitor (per-device) values — used only to post-multiply meter readings
  // so the display matches what the user actually hears. Does not affect
  // the master fader (which drives the project-scoped masterBusDb).
  const monitorVolume = usePlaybackStore((s) => s.volume)
  const muted = usePlaybackStore((s) => s.muted)
  const toggleMute = usePlaybackStore((s) => s.toggleMute)
  const busAudioEq = usePlaybackStore((s) => s.busAudioEq)
  const setBusAudioEq = usePlaybackStore((s) => s.setBusAudioEq)

  const [waveformsByMediaId, setWaveformsByMediaId] = useState<
    Map<string, AudioMeterWaveform | null>
  >(new Map())
  const meterVisualRootRef = useRef<HTMLDivElement | null>(null)
  const targetPercentRef = useRef({ left: 0, right: 0 })
  const isPlayingRef = useRef(false)
  const animationFrameRef = useRef<number | null>(null)
  const meterAnimationRef = useRef({
    left: { displayPercent: 0, peakPercent: 0, peakHoldSeconds: 0 },
    right: { displayPercent: 0, peakPercent: 0, peakHoldSeconds: 0 },
    lastTimestamp: 0,
  })

  const effectiveFrame = useMemo(
    () =>
      getResolvedPlaybackFrame({
        currentFrame,
        currentFrameEpoch: usePlaybackStore.getState().currentFrameEpoch,
        previewFrame,
        previewFrameEpoch: usePlaybackStore.getState().previewFrameEpoch,
        isPlaying,
        displayedFrame,
      }),
    [currentFrame, displayedFrame, isPlaying, previewFrame],
  )
  const combinedTracks = useMemo(() => {
    void trackSnapshotVersion
    return tracks
      .filter((track) => !track.isGroup)
      .map((track) => ({
        ...track,
        items: itemsByTrackId[track.id] ?? [],
      }))
  }, [itemsByTrackId, trackSnapshotVersion, tracks])
  const combinedTimelineItems = useMemo(
    () => combinedTracks.flatMap((track) => track.items),
    [combinedTracks],
  )
  const combinedCompositionsById = useMemo<AudioMeterCompositionLookup>(() => {
    const next: AudioMeterCompositionLookup = {}

    for (const composition of compositions) {
      const compositionItemsByTrackId: Record<string, typeof composition.items> = {}
      for (const item of composition.items) {
        ;(compositionItemsByTrackId[item.trackId] ??= []).push(item)
      }

      next[composition.id] = {
        id: composition.id,
        fps: composition.fps,
        transitions: composition.transitions ?? [],
        tracks: composition.tracks
          .filter((track) => !track.isGroup)
          .map((track) => ({
            ...track,
            items: compositionItemsByTrackId[track.id] ?? [],
          })),
      }
    }

    return next
  }, [compositions])

  const compiledGraph = useMemo(
    () =>
      compileAudioMeterGraph({
        tracks: combinedTracks,
        transitions,
        fps,
        compositionsById: combinedCompositionsById,
      }),
    [combinedCompositionsById, combinedTracks, fps, transitions],
  )

  // Re-resolve sources when live fader overrides change (fader drag in progress).
  const liveOverrideVersion = useSyncExternalStore(
    subscribeLiveOverrideVersion,
    getLiveOverrideVersion,
    getLiveOverrideVersion,
  )

  // Read bus override inside the same version-gated render cycle so playbackGain
  // recomputes whenever the bus fader moves (subscription above guarantees re-render).
  const liveBusOverrideDb = getLiveBusVolumeOverride()
  // Meter readings reflect what the user hears: project master bus (or live
  // drag override) × per-device monitor volume. Fader drags bypass the
  // stored masterBusDb via liveBusOverrideDb for no-lag feedback.
  const effectiveMasterGain =
    liveBusOverrideDb !== null
      ? Math.pow(10, liveBusOverrideDb / 20)
      : Math.pow(10, masterBusDb / 20)
  const playbackGain = isPlaying && !muted ? effectiveMasterGain * monitorVolume : 0

  const preloadSources = useMemo(() => {
    void liveOverrideVersion
    return resolveCompiledAudioMeterSources({
      graph: compiledGraph,
      frame: effectiveFrame,
      masterGain: 1,
    })
  }, [compiledGraph, effectiveFrame, liveOverrideVersion])

  // Per-track sources include track volume but not master/bus volume.
  const perTrackSources = useMemo(() => {
    if (!isPlaying || muted) return []
    return preloadSources
  }, [isPlaying, muted, preloadSources])

  // Bus/master sources include both track volume and master volume.
  const sources = useMemo(() => {
    if (playbackGain <= 0.0001) {
      return []
    }

    return preloadSources.map((source) => ({
      ...source,
      gain: source.gain * playbackGain,
    }))
  }, [playbackGain, preloadSources])

  const activeMediaIds = useMemo(() => {
    return [...new Set(preloadSources.map((source) => source.mediaId))].sort()
  }, [preloadSources])
  const activeMediaIdsKey = activeMediaIds.join('|')
  const stableActiveMediaIdsRef = useRef<{ key: string; ids: string[] }>({ key: '', ids: [] })
  if (stableActiveMediaIdsRef.current.key !== activeMediaIdsKey) {
    stableActiveMediaIdsRef.current = { key: activeMediaIdsKey, ids: activeMediaIds }
  }
  const stableActiveMediaIds = stableActiveMediaIdsRef.current.ids

  useEffect(() => {
    if (stableActiveMediaIds.length === 0) {
      setWaveformsByMediaId(new Map())
      return
    }

    let cancelled = false
    const unsubscribeFns: Array<() => void> = []

    void Promise.all([importWaveformCache(), importMediaLibraryService()]).then(
      ([waveformModule, mediaLibraryModule]) => {
        if (cancelled) {
          return
        }

        const { waveformCache } = waveformModule
        const { mediaLibraryService } = mediaLibraryModule

        setWaveformsByMediaId(() => {
          const next = new Map<string, AudioMeterWaveform | null>()
          for (const mediaId of stableActiveMediaIds) {
            next.set(mediaId, toWaveformSnapshot(waveformCache.getFromMemoryCacheSync(mediaId)))
          }
          return next
        })

        for (const mediaId of stableActiveMediaIds) {
          unsubscribeFns.push(
            waveformCache.subscribe(mediaId, (updated) => {
              if (cancelled) {
                return
              }

              setWaveformsByMediaId((previous) => {
                const next = new Map(previous)
                next.set(mediaId, toWaveformSnapshot(updated))
                return next
              })
            }),
          )

          const cached = waveformCache.getFromMemoryCacheSync(mediaId)
          if (cached?.isComplete) {
            continue
          }

          void mediaLibraryService
            .getMediaBlobUrl(mediaId)
            .then(async (blobUrl) => {
              if (!blobUrl) {
                return
              }

              try {
                await waveformCache.getWaveform(mediaId, blobUrl)
              } finally {
                URL.revokeObjectURL(blobUrl)
              }
            })
            .catch(() => {
              // Best-effort meter loading only.
            })
        }
      },
    )

    return () => {
      cancelled = true
      for (const unsubscribe of unsubscribeFns) {
        unsubscribe()
      }
    }
  }, [stableActiveMediaIds])

  const estimate = useMemo(() => {
    return estimateAudioMeterLevel({
      sources,
      waveformsByMediaId,
    })
  }, [sources, waveformsByMediaId])
  const maxLevel = Math.max(estimate.left, estimate.right)
  const statusLabel = !isPlaying
    ? 'Idle'
    : estimate.unresolvedSourceCount > 0 && estimate.resolvedSourceCount === 0
      ? 'Scanning'
      : formatMeterDb(maxLevel)
  const scanFallbackPercent =
    isPlaying && estimate.unresolvedSourceCount > 0 && estimate.resolvedSourceCount === 0 ? 18 : 0

  // ---------------------------------------------------------------------------
  // Meter animation (only active in meter mode, but state kept alive)
  // ---------------------------------------------------------------------------

  const applyMeterVisuals = useCallback(
    (leftDisplay: number, leftPeak: number, rightDisplay: number, rightPeak: number) => {
      if (meterVisualRootRef.current) {
        const el = meterVisualRootRef.current
        el.style.setProperty('--meter-l', `${leftDisplay}%`)
        el.style.setProperty('--meter-l-peak', `${leftPeak}%`)
        el.style.setProperty('--meter-r', `${rightDisplay}%`)
        el.style.setProperty('--meter-r-peak', `${rightPeak}%`)
      }
    },
    [],
  )

  const runMeterAnimation = useRef<(timestamp: number) => void>(() => {})
  runMeterAnimation.current = (timestamp: number) => {
    const state = meterAnimationRef.current
    const deltaSeconds =
      state.lastTimestamp > 0 ? Math.min(0.05, (timestamp - state.lastTimestamp) / 1000) : 1 / 60
    state.lastTimestamp = timestamp

    const { left: targetLeft, right: targetRight } = targetPercentRef.current
    animateChannel(state.left, targetLeft, deltaSeconds)
    animateChannel(state.right, targetRight, deltaSeconds)

    applyMeterVisuals(
      state.left.displayPercent,
      state.left.peakPercent,
      state.right.displayPercent,
      state.right.peakPercent,
    )

    const shouldContinue =
      isPlayingRef.current ||
      targetLeft > 0.1 ||
      targetRight > 0.1 ||
      state.left.displayPercent > 0.1 ||
      state.right.displayPercent > 0.1 ||
      state.left.peakPercent > 0.1 ||
      state.right.peakPercent > 0.1

    if (shouldContinue) {
      animationFrameRef.current = requestAnimationFrame(runMeterAnimation.current)
      return
    }

    animationFrameRef.current = null
    state.lastTimestamp = 0
  }

  const ensureMeterAnimation = useCallback(() => {
    if (animationFrameRef.current !== null) {
      return
    }
    animationFrameRef.current = requestAnimationFrame(runMeterAnimation.current)
  }, [])

  useEffect(() => {
    isPlayingRef.current = isPlaying
    targetPercentRef.current = {
      left: Math.max(linearLevelToPercent(estimate.left), scanFallbackPercent),
      right: Math.max(linearLevelToPercent(estimate.right), scanFallbackPercent),
    }
    ensureMeterAnimation()
  }, [ensureMeterAnimation, estimate.left, estimate.right, isPlaying, scanFallbackPercent])

  useEffect(() => {
    applyMeterVisuals(0, 0, 0, 0)
    const meterAnimation = meterAnimationRef.current
    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
      const anim = meterAnimation
      anim.left.displayPercent = 0
      anim.left.peakPercent = 0
      anim.left.peakHoldSeconds = 0
      anim.right.displayPercent = 0
      anim.right.peakPercent = 0
      anim.right.peakHoldSeconds = 0
      anim.lastTimestamp = 0
    }
  }, [applyMeterVisuals])

  // ---------------------------------------------------------------------------
  // Mixer-mode data
  // ---------------------------------------------------------------------------

  const mixerSourceTracks = useMemo(() => {
    return combinedTracks.filter((track) => isAudioMixerTrack(track, combinedTimelineItems))
  }, [combinedTimelineItems, combinedTracks])

  const mixerTracks = useMemo<AudioMixerTrack[]>(() => {
    return mixerSourceTracks.map((track) => ({
      id: track.id,
      name: track.name,
      kind: track.kind,
      color: track.color,
      muted: track.muted,
      solo: track.solo,
      volume: track.volume || 0,
      eqEnabled: !!track.audioEq && track.audioEq.enabled !== false,
      itemIds: track.items.map((item) => item.id),
    }))
  }, [mixerSourceTracks])

  const perTrackLevels = useMemo(() => {
    if ((panelMode !== 'mixer' && !mixerFloating) || perTrackSources.length === 0)
      return EMPTY_PER_TRACK_LEVELS
    return estimatePerTrackLevels({
      tracks: combinedTracks,
      sources: perTrackSources,
      waveformsByMediaId,
      targetTrackIds: mixerSourceTracks.map((track) => track.id),
    })
  }, [
    combinedTracks,
    mixerFloating,
    mixerSourceTracks,
    panelMode,
    perTrackSources,
    waveformsByMediaId,
  ])

  const eqPanelDescriptor = useMemo<EqPanelDescriptor | null>(() => {
    if (!eqPanelTarget) return null

    if (eqPanelTarget.kind === 'track') {
      const track = mixerSourceTracks.find((entry) => entry.id === eqPanelTarget.trackId)
      if (!track) return null
      return {
        title: track.name,
        targetLabel: track.name,
        trackId: track.id,
        trackEq: track.audioEq,
        eqEnabled: track.audioEq?.enabled !== false,
      }
    }

    return {
      title: 'Bus 1',
      targetLabel: 'Bus 1',
      busEq: busAudioEq,
      eqEnabled: busAudioEq?.enabled !== false,
    }
  }, [busAudioEq, eqPanelTarget, mixerSourceTracks])

  useEffect(() => {
    if (eqPanelTarget && !eqPanelDescriptor) {
      setEqPanelTarget(null)
    }
  }, [eqPanelDescriptor, eqPanelTarget])

  // Commit track volume in place to avoid preview playback stalls during active playback.
  // Undo remains correct because we add an explicit pre-mutation snapshot entry.
  // Local version state forces the mixer UI to pick up the mutated track value.
  const handleTrackVolumeChange = useCallback((trackId: string, volumeDb: number) => {
    if (!Number.isFinite(volumeDb)) return
    const currentTracks = useItemsStore.getState().tracks
    const targetTrack = currentTracks.find((track) => track.id === trackId)
    if (!targetTrack) return
    const snapshot = captureSnapshot()
    const beforeSnapshot = {
      ...snapshot,
      tracks: snapshot.tracks.map((track) => ({ ...track })),
    }

    let didChange = false
    const safeTargetVolume =
      typeof targetTrack.volume === 'number' && Number.isFinite(targetTrack.volume)
        ? targetTrack.volume
        : 0
    if (Math.abs(safeTargetVolume - volumeDb) > 0.0001) {
      didChange = true
    }

    for (const track of currentTracks) {
      if (track.id === trackId) {
        ;(track as { volume: number }).volume = volumeDb
        continue
      }
      if (!Number.isFinite(track.volume)) {
        ;(track as { volume: number }).volume = 0
        didChange = true
      }
    }

    if (!didChange) {
      return
    }

    useTimelineStore.getState().markDirty()
    useTimelineCommandStore
      .getState()
      .addUndoEntry({ type: 'UPDATE_TRACK_VOLUME', payload: { id: trackId } }, beforeSnapshot)
    setTrackSnapshotVersion((version) => version + 1)
  }, [])

  const handleTrackEqChange = useCallback((trackId: string, patch: AudioEqPatch) => {
    const itemsState = useItemsStore.getState()
    const currentTracks = itemsState.tracks
    const targetTrack = currentTracks.find((track) => track.id === trackId)
    if (!targetTrack) return
    const snapshot = captureSnapshot()
    const beforeSnapshot = {
      ...snapshot,
      tracks: snapshot.tracks.map((track) => ({ ...track })),
    }
    const eqPatch = getSparseAudioEqSettings(patch)
    const nextTrackEq = { ...targetTrack.audioEq, ...eqPatch, midGainDb: 0 }
    const nextTracks = currentTracks.map((track) =>
      track.id === trackId ? { ...track, audioEq: nextTrackEq } : track,
    )
    itemsState.setTracks(nextTracks)
    const trackItemIds = (itemsState.itemsByTrackId[trackId] ?? []).map((item) => item.id)
    if (trackItemIds.length > 0) {
      useGizmoStore.getState().clearPreviewForItems(trackItemIds)
    }
    useTimelineStore.getState().markDirty()
    useTimelineCommandStore
      .getState()
      .addUndoEntry({ type: 'UPDATE_TRACK_EQ', payload: { id: trackId } }, beforeSnapshot)
    setTrackSnapshotVersion((version) => version + 1)
  }, [])

  const handleTrackEqEnabledChange = useCallback((trackId: string, enabled: boolean) => {
    const itemsState = useItemsStore.getState()
    const currentTracks = itemsState.tracks
    const targetTrack = currentTracks.find((track) => track.id === trackId)
    if (!targetTrack) return
    const snapshot = captureSnapshot()
    const beforeSnapshot = {
      ...snapshot,
      tracks: snapshot.tracks.map((track) => ({ ...track })),
    }
    const nextTracks = currentTracks.map((track) =>
      track.id === trackId ? { ...track, audioEq: { ...(track.audioEq ?? {}), enabled } } : track,
    )
    itemsState.setTracks(nextTracks)
    const trackItemIds = (itemsState.itemsByTrackId[trackId] ?? []).map((item) => item.id)
    if (trackItemIds.length > 0) {
      useGizmoStore.getState().clearPreviewForItems(trackItemIds)
    }
    useTimelineStore.getState().markDirty()
    useTimelineCommandStore
      .getState()
      .addUndoEntry({ type: 'UPDATE_TRACK_EQ_ENABLED', payload: { id: trackId } }, beforeSnapshot)
    setTrackSnapshotVersion((version) => version + 1)
  }, [])

  const handleBusEqChange = useCallback(
    (patch: AudioEqPatch) => {
      const snapshot = captureSnapshot()
      const eqPatch = getSparseAudioEqSettings(patch)
      const current = usePlaybackStore.getState().busAudioEq
      setBusAudioEq({ ...current, ...eqPatch, midGainDb: 0 })
      useTimelineStore.getState().markDirty()
      useTimelineCommandStore
        .getState()
        .addUndoEntry({ type: 'UPDATE_BUS_EQ', payload: {} }, snapshot)
    },
    [setBusAudioEq],
  )

  const handleBusEqEnabledChange = useCallback(
    (enabled: boolean) => {
      const snapshot = captureSnapshot()
      const current = usePlaybackStore.getState().busAudioEq
      setBusAudioEq({ ...(current ?? {}), enabled })
      useTimelineStore.getState().markDirty()
      useTimelineCommandStore
        .getState()
        .addUndoEntry({ type: 'UPDATE_BUS_EQ_ENABLED', payload: {} }, snapshot)
    },
    [setBusAudioEq],
  )

  const ensureDetachedEqWindow = useCallback(() => {
    const existingWindow = eqDetachedWindowRef.current
    if (existingWindow && !existingWindow.closed) {
      existingWindow.focus()
      return true
    }

    // Size is fixed from DETACHED_EQ_DEFAULT_BOUNDS; position is a hint ââ‚¬”
    // WindowPortal will apply the persisted position and force correct size
    // via resizeTo on mount.
    const nextWindow = window.open(
      '',
      '',
      [
        `width=${DETACHED_EQ_DEFAULT_BOUNDS.width}`,
        `height=${DETACHED_EQ_DEFAULT_BOUNDS.height}`,
        `left=${window.screenX + 120}`,
        `top=${window.screenY + 80}`,
        'menubar=no',
        'toolbar=no',
        'location=no',
        'status=no',
      ].join(','),
    )

    if (!nextWindow) {
      return false
    }

    eqDetachedWindowRef.current = nextWindow
    return true
  }, [])

  // Collect all item IDs for a track (needed for live gain bridging)
  const getTrackItemIds = useCallback((trackId: string): string[] => {
    const items = useItemsStore.getState().itemsByTrackId[trackId]
    return items ? items.map((item) => item.id) : []
  }, [])

  // Apply live gains to reflect current mute/solo state across all mixer tracks.
  // Called after in-place mutation so the audio path picks up changes immediately
  // without waiting for a full composition re-render.
  const applyMuteSoloLiveGains = useCallback(() => {
    const currentTracks = useItemsStore.getState().tracks
    const currentItemsByTrackId = useItemsStore.getState().itemsByTrackId
    const currentTimelineItems = Object.values(currentItemsByTrackId).flat()
    const audioTracks = currentTracks
      .filter((t) => !t.isGroup)
      .map((track) => ({
        ...track,
        items: currentItemsByTrackId[track.id] ?? [],
      }))
      .filter((track) => isAudioMixerTrack(track, currentTimelineItems))
    if (audioTracks.length === 0) {
      clearMixerLiveGainLayer(MUTE_SOLO_LIVE_GAIN_LAYER_ID)
      return
    }
    const anySoloed = audioTracks.some((t) => t.solo)
    const liveGainEntries: Array<{ itemId: string; gain: number }> = []

    for (const t of audioTracks) {
      const shouldMute = t.muted || (anySoloed && !t.solo)
      const gain = shouldMute ? 0 : 1
      for (const itemId of getTrackItemIds(t.id)) {
        liveGainEntries.push({ itemId, gain })
      }
    }

    if (liveGainEntries.length > 0) {
      setMixerLiveGainLayer(MUTE_SOLO_LIVE_GAIN_LAYER_ID, liveGainEntries)
    } else {
      clearMixerLiveGainLayer(MUTE_SOLO_LIVE_GAIN_LAYER_ID)
    }
  }, [getTrackItemIds])

  // In-place mutation for mute/solo ââ‚¬” same pattern as volume change.
  // setTracks() triggers full composition re-render which stalls playback.
  // Live gains bridge the gap so audio responds immediately.
  const handleTrackMuteToggle = useCallback(
    (trackId: string) => {
      const currentTracks = useItemsStore.getState().tracks
      const track = currentTracks.find((t) => t.id === trackId)
      if (!track) return
      const snapshot = captureSnapshot()
      const beforeSnapshot = {
        ...snapshot,
        tracks: snapshot.tracks.map((t) => ({ ...t })),
      }
      ;(track as { muted: boolean }).muted = !track.muted
      applyMuteSoloLiveGains()
      useTimelineStore.getState().markDirty()
      useTimelineCommandStore
        .getState()
        .addUndoEntry({ type: 'UPDATE_TRACK_MUTE', payload: { id: trackId } }, beforeSnapshot)
      setTrackSnapshotVersion((version) => version + 1)
    },
    [applyMuteSoloLiveGains],
  )

  const handleTrackSoloToggle = useCallback(
    (trackId: string) => {
      const currentTracks = useItemsStore.getState().tracks
      const track = currentTracks.find((t) => t.id === trackId)
      if (!track) return
      const snapshot = captureSnapshot()
      const beforeSnapshot = {
        ...snapshot,
        tracks: snapshot.tracks.map((t) => ({ ...t })),
      }
      ;(track as { solo: boolean }).solo = !track.solo
      applyMuteSoloLiveGains()
      useTimelineStore.getState().markDirty()
      useTimelineCommandStore
        .getState()
        .addUndoEntry({ type: 'UPDATE_TRACK_SOLO', payload: { id: trackId } }, beforeSnapshot)
      setTrackSnapshotVersion((version) => version + 1)
    },
    [applyMuteSoloLiveGains],
  )

  const handleTrackEqToggle = useCallback(
    (trackId: string) => {
      if (eqPanelTarget?.kind === 'track' && eqPanelTarget.trackId === trackId) {
        setEqPanelTarget(null)
        return
      }

      if (!ensureDetachedEqWindow()) {
        return
      }

      const targetTrack = useItemsStore.getState().tracks.find((track) => track.id === trackId)
      if (targetTrack && !targetTrack.audioEq) {
        handleTrackEqEnabledChange(trackId, true)
      }

      setEqPanelTarget({ kind: 'track', trackId })
    },
    [ensureDetachedEqWindow, eqPanelTarget, handleTrackEqEnabledChange],
  )

  const handleBusEqToggle = useCallback(() => {
    if (eqPanelTarget?.kind === 'bus') {
      setEqPanelTarget(null)
      return
    }

    if (!ensureDetachedEqWindow()) {
      return
    }

    if (!usePlaybackStore.getState().busAudioEq) {
      handleBusEqEnabledChange(true)
    }

    setEqPanelTarget({ kind: 'bus' })
  }, [ensureDetachedEqWindow, eqPanelTarget, handleBusEqEnabledChange])

  // ---------------------------------------------------------------------------
  // Master bus fader — drives the project-scoped masterBusDb. This affects
  // both preview and export and is saved with the project. The per-device
  // monitor slider near the playback controls is a separate post-bus gain.
  // ---------------------------------------------------------------------------

  const masterVolumeDb = useMemo(() => Math.max(-60, Math.min(12, masterBusDb)), [masterBusDb])

  const handleMasterVolumeChange = useCallback(
    (db: number) => {
      setMasterBusDb(db)
    },
    [setMasterBusDb],
  )

  // ---------------------------------------------------------------------------
  // Mode dropdown (shared across both views)
  // ---------------------------------------------------------------------------

  const modeDropdown = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="h-5 w-5 shrink-0 flex items-center justify-center rounded text-muted-foreground/60 hover:text-muted-foreground hover:bg-muted/50 transition-colors"
          aria-label="Panel mode"
        >
          <MoreHorizontal size={14} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[120px]">
        <DropdownMenuItem onClick={() => setPanelMode('meter')}>
          <span className="w-4 inline-flex items-center justify-start">
            {panelMode === 'meter' && <Check className="h-3.5 w-3.5" />}
          </span>
          Meters
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setPanelMode('mixer')}>
          <span className="w-4 inline-flex items-center justify-start">
            {panelMode === 'mixer' && <Check className="h-3.5 w-3.5" />}
          </span>
          Mixer
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => {
            if (!mixerFloating) setPanelMode('mixer')
            setMixerFloating(!mixerFloating)
          }}
        >
          <span className="w-4 inline-flex items-center justify-start">
            {mixerFloating && <Check className="h-3.5 w-3.5" />}
          </span>
          Float Mixer
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )

  const eqPanelContentProps = useMemo(() => {
    if (!eqPanelDescriptor) return null

    return {
      targetLabel: eqPanelDescriptor.targetLabel,
      trackEq:
        'trackEq' in eqPanelDescriptor
          ? eqPanelDescriptor.trackEq
          : 'busEq' in eqPanelDescriptor
            ? eqPanelDescriptor.busEq
            : undefined,
      enabled: eqPanelDescriptor.eqEnabled,
      onTrackEqChange:
        'trackId' in eqPanelDescriptor
          ? (patch: AudioEqPatch) => handleTrackEqChange(eqPanelDescriptor.trackId, patch)
          : 'busEq' in eqPanelDescriptor
            ? handleBusEqChange
            : undefined,
      onEnabledChange:
        'trackId' in eqPanelDescriptor
          ? (enabled: boolean) => handleTrackEqEnabledChange(eqPanelDescriptor.trackId, enabled)
          : 'busEq' in eqPanelDescriptor
            ? handleBusEqEnabledChange
            : undefined,
    }
  }, [
    eqPanelDescriptor,
    handleBusEqChange,
    handleBusEqEnabledChange,
    handleTrackEqChange,
    handleTrackEqEnabledChange,
  ])

  // ---------------------------------------------------------------------------
  // Floating mixer (rendered via portal, independent of panel mode)
  // ---------------------------------------------------------------------------

  const floatingMixer = mixerFloating ? (
    <FloatingPanel
      title="Mixer"
      defaultBounds={FLOATING_MIXER_DEFAULT_BOUNDS}
      minWidth={200}
      minHeight={280}
      storageKey={FLOATING_MIXER_STORAGE_KEY}
      onClose={() => setMixerFloating(false)}
      headerExtra={modeDropdown}
      autoWidth
    >
      <AudioMixerView
        tracks={mixerTracks}
        perTrackLevels={perTrackLevels}
        masterEstimate={estimate}
        isPlaying={isPlaying}
        masterVolumeDb={masterVolumeDb}
        masterMuted={muted}
        onMasterVolumeChange={handleMasterVolumeChange}
        onMasterMuteToggle={toggleMute}
        onTrackVolumeChange={handleTrackVolumeChange}
        onTrackMuteToggle={handleTrackMuteToggle}
        onTrackSoloToggle={handleTrackSoloToggle}
        onTrackEqToggle={handleTrackEqToggle}
        onBusEqToggle={handleBusEqToggle}
        busEqEnabled={!!busAudioEq && busAudioEq.enabled !== false}
        expanded
      />
    </FloatingPanel>
  ) : null

  const detachedEqPanel =
    eqPanelDescriptor && eqPanelContentProps ? (
      <WindowPortal
        title={`Equalizer - ${eqPanelDescriptor.title}`}
        width={DETACHED_EQ_DEFAULT_BOUNDS.width}
        height={DETACHED_EQ_DEFAULT_BOUNDS.height}
        storageKey={DETACHED_EQ_STORAGE_KEY}
        externalWindow={eqDetachedWindowRef.current}
        autoHeight
        onBlocked={() => {
          eqDetachedWindowRef.current = null
          setEqPanelTarget(null)
        }}
        onClose={() => {
          eqDetachedWindowRef.current = null
          setEqPanelTarget(null)
        }}
      >
        <AudioEqPanelSurface layoutMode="floating" {...eqPanelContentProps} />
      </WindowPortal>
    ) : null

  // ---------------------------------------------------------------------------
  // Mixer mode (docked)
  // ---------------------------------------------------------------------------

  if (panelMode === 'mixer' && !mixerFloating) {
    return (
      <>
        {detachedEqPanel}
        <AudioMixerView
          tracks={mixerTracks}
          perTrackLevels={perTrackLevels}
          masterEstimate={estimate}
          isPlaying={isPlaying}
          masterVolumeDb={masterVolumeDb}
          masterMuted={muted}
          onMasterVolumeChange={handleMasterVolumeChange}
          onMasterMuteToggle={toggleMute}
          onTrackVolumeChange={handleTrackVolumeChange}
          onTrackMuteToggle={handleTrackMuteToggle}
          onTrackSoloToggle={handleTrackSoloToggle}
          onTrackEqToggle={handleTrackEqToggle}
          onBusEqToggle={handleBusEqToggle}
          busEqEnabled={!!busAudioEq && busAudioEq.enabled !== false}
          headerExtra={modeDropdown}
        />
      </>
    )
  }

  // ---------------------------------------------------------------------------
  // Meter mode (default) ââ‚¬” also shows floating mixer if enabled
  // ---------------------------------------------------------------------------

  // Segmented LED mask ââ‚¬” matches the mixer view segments
  const segmentMask =
    'repeating-linear-gradient(to top, black 0px, black 3px, transparent 3px, transparent 4px)'
  const unlitLedBg =
    'repeating-linear-gradient(to top, rgba(255,255,255,0.03) 0px, rgba(255,255,255,0.03) 3px, transparent 3px, transparent 4px)'
  const isScanningMeter = estimate.unresolvedSourceCount > 0 && estimate.resolvedSourceCount === 0

  return (
    <>
      {detachedEqPanel}
      {floatingMixer}
      <aside
        className="panel-bg border-l border-border flex h-full flex-col overflow-hidden"
        style={{ width: EDITOR_LAYOUT_CSS_VALUES.timelineMeterWidth }}
        aria-label="Audio meter"
      >
        <div
          className="flex min-w-0 items-center justify-between gap-1 border-b border-border bg-secondary/20 px-1.5"
          style={{ height: EDITOR_LAYOUT_CSS_VALUES.timelineTracksHeaderHeight }}
        >
          <span className="min-w-0 text-xs text-muted-foreground font-mono uppercase tracking-[0.12em]">
            Meters
          </span>
          {modeDropdown}
        </div>

        <div className="flex-1 px-2 py-3 min-h-0">
          <div className="h-full rounded-md border border-border/50 bg-black/30 px-2 py-3 shadow-[inset_0_1px_4px_rgba(0,0,0,0.4)]">
            <div className="mb-3 text-center text-[10px] uppercase tracking-[0.22em] text-muted-foreground/70 font-mono">
              Master
            </div>

            <div className="flex h-[calc(100%-2.75rem)] items-stretch gap-3">
              {/* Scale marks */}
              <div className="relative flex-1 min-w-0">
                {AUDIO_METER_SCALE_MARKS.map((mark) => {
                  const bottom = `${dbMarkToPercent(mark)}%`
                  return (
                    <div key={mark} className="absolute inset-x-0" style={{ bottom }}>
                      <div className="absolute left-0 right-5 h-px bg-border/30" />
                      <span className="absolute right-0 -translate-y-1/2 text-[10px] font-mono text-muted-foreground/50">
                        {mark}
                      </span>
                    </div>
                  )
                })}
              </div>

              {/* Segmented stereo meters */}
              <div className="flex flex-col items-center">
                <div ref={meterVisualRootRef} className="flex flex-1 gap-[3px]">
                  {/* Left channel */}
                  <div className="relative w-[14px] rounded-[2px] border border-border/50 bg-[#08090b] shadow-[inset_0_1px_2px_rgba(0,0,0,0.5)] overflow-hidden">
                    {/* Unlit LED backdrop */}
                    <div
                      className="absolute inset-0 pointer-events-none"
                      style={{ background: unlitLedBg }}
                    />
                    {/* Active fill with segment mask */}
                    <div
                      className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#1be255] via-[#f5e146] to-[#ff6633] transition-[height] duration-75 ease-out ${isScanningMeter ? 'opacity-50' : ''}`}
                      style={{
                        height: 'var(--meter-l, 0%)',
                        maskImage: segmentMask,
                        WebkitMaskImage: segmentMask,
                      }}
                    />
                    {/* Peak hold ââ‚¬” single bright segment */}
                    <div
                      className="absolute inset-x-0 h-[3px] bg-white/85 shadow-[0_0_5px_rgba(255,255,255,0.5)] transition-[bottom] duration-100 ease-out"
                      style={{
                        bottom: 'calc(var(--meter-l-peak, 0%) - 1px)',
                        maskImage: segmentMask,
                        WebkitMaskImage: segmentMask,
                      }}
                    />
                  </div>
                  {/* Right channel */}
                  <div className="relative w-[14px] rounded-[2px] border border-border/50 bg-[#08090b] shadow-[inset_0_1px_2px_rgba(0,0,0,0.5)] overflow-hidden">
                    {/* Unlit LED backdrop */}
                    <div
                      className="absolute inset-0 pointer-events-none"
                      style={{ background: unlitLedBg }}
                    />
                    {/* Active fill with segment mask */}
                    <div
                      className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#1be255] via-[#f5e146] to-[#ff6633] transition-[height] duration-75 ease-out ${isScanningMeter ? 'opacity-50' : ''}`}
                      style={{
                        height: 'var(--meter-r, 0%)',
                        maskImage: segmentMask,
                        WebkitMaskImage: segmentMask,
                      }}
                    />
                    {/* Peak hold ââ‚¬” single bright segment */}
                    <div
                      className="absolute inset-x-0 h-[3px] bg-white/85 shadow-[0_0_5px_rgba(255,255,255,0.5)] transition-[bottom] duration-100 ease-out"
                      style={{
                        bottom: 'calc(var(--meter-r-peak, 0%) - 1px)',
                        maskImage: segmentMask,
                        WebkitMaskImage: segmentMask,
                      }}
                    />
                  </div>
                </div>
                <div className="mt-1 flex gap-[3px] text-[8px] font-mono text-muted-foreground/40 justify-center">
                  <span className="w-[14px] text-center">L</span>
                  <span className="w-[14px] text-center">R</span>
                </div>
              </div>
            </div>

            {/* Peak dB readout */}
            <div className="mt-3 text-center text-[10px] font-mono text-muted-foreground/70">
              {statusLabel}
            </div>
          </div>
        </div>
      </aside>
    </>
  )
})
