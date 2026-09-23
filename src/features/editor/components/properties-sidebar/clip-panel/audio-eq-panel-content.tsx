import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { updateItem } from '@/features/editor/deps/timeline-store'
import { useGizmoStore } from '@/features/editor/deps/preview'
import { type TimelineItem } from '@/types/timeline'
import { demixValue } from '../utils/mixed-value'
import { type AudioEqPatch } from './audio-eq-curve-editor'
import { getAudioSectionItems } from './audio-section-utils'
import {
  getEqControlsDisabled,
  getEqPresetPlaceholder,
  hasMixedEqDisplayValues,
  resolveEqDisplayValues,
} from './audio-eq-panel-values'
import { getAudioEqPanelBandViews, type AudioEqBandView } from './audio-eq-panel-bands'
import { AudioEqPanelGainBands } from './audio-eq-panel-band-cards'
import { CompactBandRows } from './audio-eq-panel-compact-bands'
import { AudioEqPanelGraph } from './audio-eq-panel-graph'
import { AudioEqPanelCompactToolbar, AudioEqPanelHeader } from './audio-eq-panel-toolbar'
import {
  DEFAULT_GAIN_BAND_CONTROL_RANGES,
  buildTimelineEqPatchFromResolvedSettings,
  clampFrequencyToAudioEqControlRange,
  normalizeUiEqPatch,
  toTimelineEqPatch,
  type AudioEqControlRangeId,
  type AudioEqGainBandControlRanges,
} from './audio-eq-ui'
import {
  AUDIO_EQ_HIGH_CUT_FREQUENCY_HZ,
  AUDIO_EQ_HIGH_FREQUENCY_HZ,
  AUDIO_EQ_HIGH_MID_FREQUENCY_HZ,
  AUDIO_EQ_HIGH_MID_Q,
  AUDIO_EQ_LOW_CUT_FREQUENCY_HZ,
  AUDIO_EQ_LOW_FREQUENCY_HZ,
  AUDIO_EQ_LOW_MID_FREQUENCY_HZ,
  AUDIO_EQ_LOW_MID_Q,
  type AudioEqPresetId,
  findAudioEqPresetId,
  getAudioEqPresetById,
  resolveAudioEqSettings,
} from '@/shared/utils/audio-eq'

interface AudioEqPanelContentProps {
  targetLabel: string
  items?: TimelineItem[]
  trackEq?: import('@/types/audio').AudioEqSettings
  enabled?: boolean
  onTrackEqChange?: (patch: AudioEqPatch) => void
  onEnabledChange?: (enabled: boolean) => void
  portalContainer?: HTMLElement | null
  layoutMode?: 'floating' | 'detached' | 'compact'
}

export function AudioEqPanelContent({
  items,
  targetLabel,
  trackEq,
  enabled = true,
  onTrackEqChange,
  onEnabledChange,
  portalContainer,
  layoutMode = 'floating',
}: AudioEqPanelContentProps) {
  const isTrackMode = onTrackEqChange !== undefined
  const isDetachedLayout = layoutMode === 'detached'
  const isCompactLayout = layoutMode === 'compact'
  const eqEnabled = enabled !== false
  const setPropertiesPreviewNew = useGizmoStore((s) => s.setPropertiesPreviewNew)
  const clearPreviewForItems = useGizmoStore((s) => s.clearPreviewForItems)

  const audioItems = useMemo(
    () => (isTrackMode ? [] : getAudioSectionItems(items ?? [])),
    [isTrackMode, items],
  )
  const itemIds = useMemo(() => audioItems.map((item) => item.id), [audioItems])

  const clipEqEnabled = useMemo(() => {
    if (isTrackMode || audioItems.length === 0) return true
    return audioItems.every((item) => item.audioEqEnabled === true)
  }, [audioItems, isTrackMode])

  const handleClipEqEnabledChange = useCallback(
    (checked: boolean) => {
      itemIds.forEach((id) => updateItem(id, { audioEqEnabled: checked }))
    },
    [itemIds],
  )

  const resolvedTrackEq = useMemo(
    () => (isTrackMode ? resolveAudioEqSettings(trackEq ?? {}) : null),
    [isTrackMode, trackEq],
  )
  const resolvedItemEqSettings = useMemo(
    () => audioItems.map((item) => resolveAudioEqSettings(item)),
    [audioItems],
  )

  const [livePatch, setLivePatch] = useState<AudioEqPatch | null>(null)
  const [gainBandControlRanges, setGainBandControlRanges] = useState<AudioEqGainBandControlRanges>(
    DEFAULT_GAIN_BAND_CONTROL_RANGES,
  )

  useEffect(() => {
    setLivePatch(null)
    setGainBandControlRanges(DEFAULT_GAIN_BAND_CONTROL_RANGES)
  }, [targetLabel])

  const eqValues = useMemo(
    () => resolveEqDisplayValues(livePatch, resolvedTrackEq, resolvedItemEqSettings),
    [livePatch, resolvedTrackEq, resolvedItemEqSettings],
  )
  const {
    outputGainDb: eqOutputGainDb,
    band1Enabled: eqBand1Enabled,
    band1Type: eqBand1Type,
    band1FrequencyHz: eqBand1FrequencyHz,
    band1GainDb: eqBand1GainDb,
    band1Q: eqBand1Q,
    band1SlopeDbPerOct: eqBand1SlopeDbPerOct,
    lowEnabled: eqLowEnabled,
    lowType: eqLowType,
    lowGainDb: eqLow,
    lowFrequencyHz: eqLowFrequencyHz,
    lowQ: eqLowQ,
    lowMidEnabled: eqLowMidEnabled,
    lowMidType: eqLowMidType,
    lowMidGainDb: eqLowMid,
    lowMidFrequencyHz: eqLowMidFrequencyHz,
    lowMidQ: eqLowMidQ,
    highMidEnabled: eqHighMidEnabled,
    highMidType: eqHighMidType,
    highMidGainDb: eqHighMid,
    highMidFrequencyHz: eqHighMidFrequencyHz,
    highMidQ: eqHighMidQ,
    highEnabled: eqHighEnabled,
    highType: eqHighType,
    highGainDb: eqHigh,
    highFrequencyHz: eqHighFrequencyHz,
    highQ: eqHighQ,
    band6Enabled: eqBand6Enabled,
    band6Type: eqBand6Type,
    band6FrequencyHz: eqBand6FrequencyHz,
    band6GainDb: eqBand6GainDb,
    band6Q: eqBand6Q,
    band6SlopeDbPerOct: eqBand6SlopeDbPerOct,
  } = eqValues
  const bandViews = useMemo(
    () => getAudioEqPanelBandViews(eqValues, gainBandControlRanges),
    [eqValues, gainBandControlRanges],
  )

  const hasMixedEqValues = hasMixedEqDisplayValues(eqValues)

  const eqControlsDisabled = getEqControlsDisabled(
    hasMixedEqValues,
    isCompactLayout,
    eqEnabled,
    clipEqEnabled,
  )

  const eqCurveSettings = useMemo(
    () =>
      resolveAudioEqSettings({
        outputGainDb: demixValue(eqOutputGainDb, 0),
        band1Enabled: demixValue(eqBand1Enabled, false),
        band1Type: demixValue(eqBand1Type, 'high-pass'),
        band1FrequencyHz: demixValue(eqBand1FrequencyHz, AUDIO_EQ_LOW_CUT_FREQUENCY_HZ),
        band1GainDb: demixValue(eqBand1GainDb, 0),
        band1Q: demixValue(eqBand1Q, AUDIO_EQ_LOW_MID_Q),
        band1SlopeDbPerOct: demixValue(eqBand1SlopeDbPerOct, 12),
        lowEnabled: demixValue(eqLowEnabled, true),
        lowType: demixValue(eqLowType, 'low-shelf'),
        lowGainDb: demixValue(eqLow, 0),
        lowFrequencyHz: demixValue(eqLowFrequencyHz, AUDIO_EQ_LOW_FREQUENCY_HZ),
        lowQ: demixValue(eqLowQ, AUDIO_EQ_LOW_MID_Q),
        lowMidEnabled: demixValue(eqLowMidEnabled, true),
        lowMidType: demixValue(eqLowMidType, 'peaking'),
        lowMidGainDb: demixValue(eqLowMid, 0),
        lowMidFrequencyHz: demixValue(eqLowMidFrequencyHz, AUDIO_EQ_LOW_MID_FREQUENCY_HZ),
        lowMidQ: demixValue(eqLowMidQ, AUDIO_EQ_LOW_MID_Q),
        midGainDb: 0,
        highMidEnabled: demixValue(eqHighMidEnabled, true),
        highMidType: demixValue(eqHighMidType, 'peaking'),
        highMidGainDb: demixValue(eqHighMid, 0),
        highMidFrequencyHz: demixValue(eqHighMidFrequencyHz, AUDIO_EQ_HIGH_MID_FREQUENCY_HZ),
        highMidQ: demixValue(eqHighMidQ, AUDIO_EQ_HIGH_MID_Q),
        highEnabled: demixValue(eqHighEnabled, true),
        highType: demixValue(eqHighType, 'high-shelf'),
        highGainDb: demixValue(eqHigh, 0),
        highFrequencyHz: demixValue(eqHighFrequencyHz, AUDIO_EQ_HIGH_FREQUENCY_HZ),
        highQ: demixValue(eqHighQ, AUDIO_EQ_HIGH_MID_Q),
        band6Enabled: demixValue(eqBand6Enabled, false),
        band6Type: demixValue(eqBand6Type, 'low-pass'),
        band6FrequencyHz: demixValue(eqBand6FrequencyHz, AUDIO_EQ_HIGH_CUT_FREQUENCY_HZ),
        band6GainDb: demixValue(eqBand6GainDb, 0),
        band6Q: demixValue(eqBand6Q, AUDIO_EQ_HIGH_MID_Q),
        band6SlopeDbPerOct: demixValue(eqBand6SlopeDbPerOct, 12),
      }),
    [
      eqOutputGainDb,
      eqBand1Enabled,
      eqBand1Type,
      eqBand1FrequencyHz,
      eqBand1GainDb,
      eqBand1Q,
      eqBand1SlopeDbPerOct,
      eqLowEnabled,
      eqLowType,
      eqHigh,
      eqHighFrequencyHz,
      eqHighQ,
      eqHighType,
      eqHighEnabled,
      eqHighMid,
      eqHighMidFrequencyHz,
      eqHighMidQ,
      eqHighMidType,
      eqHighMidEnabled,
      eqLow,
      eqLowFrequencyHz,
      eqLowQ,
      eqLowMid,
      eqLowMidFrequencyHz,
      eqLowMidQ,
      eqLowMidType,
      eqLowMidEnabled,
      eqBand6Enabled,
      eqBand6Type,
      eqBand6FrequencyHz,
      eqBand6GainDb,
      eqBand6Q,
      eqBand6SlopeDbPerOct,
    ],
  )
  const selectedEqPresetId = useMemo(
    () => (hasMixedEqValues ? null : findAudioEqPresetId(eqCurveSettings)),
    [eqCurveSettings, hasMixedEqValues],
  )

  const eqPresetPlaceholder = getEqPresetPlaceholder(hasMixedEqValues, selectedEqPresetId)

  const previewThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingPreviewRef = useRef<AudioEqPatch | null>(null)

  const clearClipEqPreview = useCallback(() => {
    if (isTrackMode || itemIds.length === 0) {
      return
    }
    clearPreviewForItems(itemIds)
  }, [clearPreviewForItems, isTrackMode, itemIds])

  useEffect(() => {
    if (isTrackMode) {
      return
    }

    return () => {
      if (previewThrottleRef.current) {
        clearTimeout(previewThrottleRef.current)
        previewThrottleRef.current = null
      }
      pendingPreviewRef.current = null
      clearClipEqPreview()
    }
  }, [clearClipEqPreview, isTrackMode])

  const handleEqPatchLiveChange = useCallback(
    (patch: AudioEqPatch) => {
      const normalizedPatch = normalizeUiEqPatch(patch)
      setLivePatch(normalizedPatch)
      if (!isTrackMode) {
        if (isCompactLayout) {
          // Throttle audio preview for clip EQ to avoid audio jitter during drag
          pendingPreviewRef.current = normalizedPatch
          if (!previewThrottleRef.current) {
            previewThrottleRef.current = setTimeout(() => {
              previewThrottleRef.current = null
              const pending = pendingPreviewRef.current
              if (pending) {
                pendingPreviewRef.current = null
                const previews: Record<string, AudioEqPatch> = {}
                itemIds.forEach((id) => {
                  previews[id] = pending
                })
                setPropertiesPreviewNew(previews)
              }
            }, 80)
          }
        } else {
          const previews: Record<string, AudioEqPatch> = {}
          itemIds.forEach((id) => {
            previews[id] = normalizedPatch
          })
          setPropertiesPreviewNew(previews)
        }
      }
    },
    [isCompactLayout, isTrackMode, itemIds, setPropertiesPreviewNew],
  )

  const handleEqPatchChange = useCallback(
    (patch: AudioEqPatch) => {
      // Flush any pending throttled preview
      if (previewThrottleRef.current) {
        clearTimeout(previewThrottleRef.current)
        previewThrottleRef.current = null
      }
      pendingPreviewRef.current = null

      setLivePatch(null)
      if (isTrackMode && onTrackEqChange) {
        onTrackEqChange(patch)
      } else {
        const normalizedPatch = toTimelineEqPatch(patch)
        itemIds.forEach((id) => updateItem(id, normalizedPatch))
        queueMicrotask(() => clearClipEqPreview())
      }
    },
    [clearClipEqPreview, isTrackMode, itemIds, onTrackEqChange],
  )

  const handleEqPresetChange = useCallback(
    (presetId: string) => {
      const preset = getAudioEqPresetById(presetId as AudioEqPresetId)
      if (!preset) return

      if (previewThrottleRef.current) {
        clearTimeout(previewThrottleRef.current)
        previewThrottleRef.current = null
      }
      pendingPreviewRef.current = null
      setLivePatch(null)
      if (isTrackMode && onTrackEqChange) {
        onTrackEqChange(buildTimelineEqPatchFromResolvedSettings(preset.settings))
      } else {
        const patch = buildTimelineEqPatchFromResolvedSettings(preset.settings)
        itemIds.forEach((id) => updateItem(id, patch))
        queueMicrotask(() => clearClipEqPreview())
      }
    },
    [clearClipEqPreview, isTrackMode, itemIds, onTrackEqChange],
  )

  const handleEqFieldChange = useCallback(
    <K extends keyof AudioEqPatch>(field: K, value: NonNullable<AudioEqPatch[K]>) => {
      handleEqPatchChange({ [field]: value } as AudioEqPatch)
    },
    [handleEqPatchChange],
  )

  const handleEqFieldLiveChange = useCallback(
    <K extends keyof AudioEqPatch>(field: K, value: NonNullable<AudioEqPatch[K]>) => {
      handleEqPatchLiveChange({ [field]: value } as AudioEqPatch)
    },
    [handleEqPatchLiveChange],
  )

  const handleBandRangeChange = useCallback(
    (view: AudioEqBandView, rangeId: AudioEqControlRangeId) => {
      const { rangeKey, frequencyField, frequencyHz } = view
      if (!rangeKey) return
      setGainBandControlRanges((current) => ({ ...current, [rangeKey]: rangeId }))
      if (frequencyHz === 'mixed') return
      const nextFrequencyHz = clampFrequencyToAudioEqControlRange(frequencyHz, rangeId)
      if (nextFrequencyHz !== frequencyHz) {
        handleEqFieldChange(frequencyField, nextFrequencyHz)
      }
    },
    [handleEqFieldChange],
  )

  if (!isTrackMode && audioItems.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-sm text-zinc-500">
        No audio clips on {targetLabel}.
      </div>
    )
  }

  return (
    <div className="flex flex-col bg-background text-foreground">
      {!isCompactLayout ? (
        <AudioEqPanelHeader
          targetLabel={targetLabel}
          eqEnabled={eqEnabled}
          presetId={selectedEqPresetId}
          presetPlaceholder={eqPresetPlaceholder}
          onEnabledChange={onEnabledChange}
          onPresetChange={handleEqPresetChange}
          portalContainer={portalContainer}
        />
      ) : null}

      <div className="flex-1 overflow-auto">
        {isCompactLayout ? (
          <AudioEqPanelCompactToolbar
            clipEqEnabled={clipEqEnabled}
            presetId={selectedEqPresetId}
            presetPlaceholder={eqPresetPlaceholder}
            onClipEqEnabledChange={handleClipEqEnabledChange}
            onPresetChange={handleEqPresetChange}
            portalContainer={portalContainer}
          />
        ) : null}
        <AudioEqPanelGraph
          settings={eqCurveSettings}
          outputGainDb={eqOutputGainDb}
          disabled={eqControlsDisabled}
          detached={isDetachedLayout}
          compact={isCompactLayout}
          trackMode={isTrackMode}
          clipCount={audioItems.length}
          onPatchLiveChange={handleEqPatchLiveChange}
          onPatchChange={handleEqPatchChange}
          onFieldChange={handleEqFieldChange}
        />
        {isCompactLayout ? (
          <CompactBandRows
            views={bandViews}
            disabled={eqControlsDisabled}
            onFieldChange={handleEqFieldChange}
            onFieldLiveChange={handleEqFieldLiveChange}
            portalContainer={portalContainer}
          />
        ) : (
          <AudioEqPanelGainBands
            views={bandViews}
            detached={isDetachedLayout}
            disabled={eqControlsDisabled}
            onFieldChange={handleEqFieldChange}
            onFieldLiveChange={handleEqFieldLiveChange}
            onPatchChange={handleEqPatchChange}
            onRangeChange={handleBandRangeChange}
            portalContainer={portalContainer}
          />
        )}
      </div>
    </div>
  )
}
