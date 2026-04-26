import { create } from 'zustand'
import { createLogger } from '@/shared/logging/logger'
import type { AudioItem, TextItem, TimelineItem, TimelineTrack, VideoItem } from '@/types/timeline'
import { getTextItemPlainText } from '@/shared/utils/text-item-spans'
import type { TransformProperties } from '@/types/transform'
import type { VisualEffect, ItemEffect } from '@/types/effects'
import {
  clampTrimAmount,
  clampToAdjacentItems,
  calculateTrimSourceUpdate,
} from '../utils/trim-utils'
import {
  getSourceProperties,
  isMediaItem,
  calculateSplitSourceBoundaries,
  timelineToSourceFrames,
  calculateSpeed,
  clampSpeed,
} from '../utils/source-calculations'
import { getLinkedItems } from '../utils/linked-items'
import { isCompositionWrapperItem, wouldCreateCompositionCycle } from '../utils/composition-graph'
import { useCompositionNavigationStore } from './composition-navigation-store'
import { useCompositionsStore } from './compositions-store'
import { useTimelineSettingsStore } from './timeline-settings-store'
import { useTransitionsStore } from './transitions-store'
import { useMarkersStore } from './markers-store'
import { clampAudioFadeCurve, clampAudioFadeCurveX } from '@/shared/utils/audio-fade-curve'
import {
  AUDIO_EQ_HIGH_CUT_FREQUENCY_HZ,
  AUDIO_EQ_HIGH_CUT_MAX_FREQUENCY_HZ,
  AUDIO_EQ_HIGH_CUT_MIN_FREQUENCY_HZ,
  AUDIO_EQ_HIGH_FREQUENCY_HZ,
  AUDIO_EQ_HIGH_MAX_FREQUENCY_HZ,
  AUDIO_EQ_HIGH_MID_FREQUENCY_HZ,
  AUDIO_EQ_HIGH_MID_MAX_FREQUENCY_HZ,
  AUDIO_EQ_HIGH_MID_MIN_FREQUENCY_HZ,
  AUDIO_EQ_HIGH_MID_Q,
  AUDIO_EQ_HIGH_MIN_FREQUENCY_HZ,
  AUDIO_EQ_LOW_CUT_FREQUENCY_HZ,
  AUDIO_EQ_LOW_CUT_MAX_FREQUENCY_HZ,
  AUDIO_EQ_LOW_CUT_MIN_FREQUENCY_HZ,
  AUDIO_EQ_LOW_FREQUENCY_HZ,
  AUDIO_EQ_LOW_MAX_FREQUENCY_HZ,
  AUDIO_EQ_LOW_MID_FREQUENCY_HZ,
  AUDIO_EQ_LOW_MID_MAX_FREQUENCY_HZ,
  AUDIO_EQ_LOW_MID_MIN_FREQUENCY_HZ,
  AUDIO_EQ_LOW_MID_Q,
  AUDIO_EQ_LOW_MIN_FREQUENCY_HZ,
  clampAudioEqCutSlopeDbPerOct,
  clampAudioEqFrequencyHz,
  clampAudioEqGainDb,
  clampAudioEqQ,
  normalizeAudioEqSettings,
} from '@/shared/utils/audio-eq'
import { normalizeCropSettings } from '@/shared/utils/media-crop'
import { clampAudioPitchCents, clampAudioPitchSemitones } from '@/shared/utils/audio-pitch'
import { getEffectiveTimelineMaxFrame, sanitizeInOutPoints } from '../utils/in-out-points'
import { resolveCornerPinTargetRect } from '@/features/timeline/deps/composition-runtime'

function getLog() {
  return createLogger('ItemsStore')
}

function roundFrame(value: number, fallback = 0): number {
  if (!Number.isFinite(value)) return fallback
  return Math.max(0, Math.round(value))
}

function roundDuration(value: number, fallback = 1): number {
  if (!Number.isFinite(value)) return fallback
  return Math.max(1, Math.round(value))
}

function roundOptionalFrame(value: number | undefined): number | undefined {
  if (value === undefined) return undefined
  return roundFrame(value)
}

function normalizeOptionalFps(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return undefined
  return Math.round(value * 1000) / 1000
}

function normalizeFrameFields<T extends TimelineItem>(item: T): T {
  const normalized = {
    ...item,
    from: roundFrame(item.from),
    durationInFrames: roundDuration(item.durationInFrames),
    trimStart: roundOptionalFrame(item.trimStart),
    trimEnd: roundOptionalFrame(item.trimEnd),
    sourceStart: roundOptionalFrame(item.sourceStart),
    sourceEnd: roundOptionalFrame(item.sourceEnd),
    sourceDuration: roundOptionalFrame(item.sourceDuration),
    sourceFps: normalizeOptionalFps(item.sourceFps),
    crop: normalizeCropSettings(item.crop),
    audioFadeInCurve:
      item.audioFadeInCurve === undefined ? undefined : clampAudioFadeCurve(item.audioFadeInCurve),
    audioFadeOutCurve:
      item.audioFadeOutCurve === undefined
        ? undefined
        : clampAudioFadeCurve(item.audioFadeOutCurve),
    audioFadeInCurveX:
      item.audioFadeInCurveX === undefined
        ? undefined
        : clampAudioFadeCurveX(item.audioFadeInCurveX),
    audioFadeOutCurveX:
      item.audioFadeOutCurveX === undefined
        ? undefined
        : clampAudioFadeCurveX(item.audioFadeOutCurveX),
    audioPitchSemitones:
      item.audioPitchSemitones === undefined
        ? undefined
        : clampAudioPitchSemitones(item.audioPitchSemitones),
    audioPitchCents:
      item.audioPitchCents === undefined ? undefined : clampAudioPitchCents(item.audioPitchCents),
    audioEqOutputGainDb:
      item.audioEqOutputGainDb === undefined
        ? undefined
        : clampAudioEqGainDb(item.audioEqOutputGainDb),
    audioEqBand1Enabled:
      item.audioEqBand1Enabled === undefined ? undefined : !!item.audioEqBand1Enabled,
    audioEqBand1Type: item.audioEqBand1Type,
    audioEqBand1FrequencyHz:
      item.audioEqBand1FrequencyHz === undefined
        ? undefined
        : clampAudioEqFrequencyHz(
            item.audioEqBand1FrequencyHz,
            AUDIO_EQ_LOW_CUT_MIN_FREQUENCY_HZ,
            AUDIO_EQ_LOW_CUT_MAX_FREQUENCY_HZ,
            AUDIO_EQ_LOW_CUT_FREQUENCY_HZ,
          ),
    audioEqBand1GainDb:
      item.audioEqBand1GainDb === undefined
        ? undefined
        : clampAudioEqGainDb(item.audioEqBand1GainDb),
    audioEqBand1Q:
      item.audioEqBand1Q === undefined
        ? undefined
        : clampAudioEqQ(item.audioEqBand1Q, AUDIO_EQ_LOW_MID_Q),
    audioEqBand1SlopeDbPerOct:
      item.audioEqBand1SlopeDbPerOct === undefined
        ? undefined
        : clampAudioEqCutSlopeDbPerOct(item.audioEqBand1SlopeDbPerOct),
    audioEqLowCutEnabled:
      item.audioEqLowCutEnabled === undefined ? undefined : !!item.audioEqLowCutEnabled,
    audioEqLowCutFrequencyHz:
      item.audioEqLowCutFrequencyHz === undefined
        ? undefined
        : clampAudioEqFrequencyHz(
            item.audioEqLowCutFrequencyHz,
            AUDIO_EQ_LOW_CUT_MIN_FREQUENCY_HZ,
            AUDIO_EQ_LOW_CUT_MAX_FREQUENCY_HZ,
            AUDIO_EQ_LOW_CUT_FREQUENCY_HZ,
          ),
    audioEqLowCutSlopeDbPerOct:
      item.audioEqLowCutSlopeDbPerOct === undefined
        ? undefined
        : clampAudioEqCutSlopeDbPerOct(item.audioEqLowCutSlopeDbPerOct),
    audioEqLowEnabled: item.audioEqLowEnabled === undefined ? undefined : !!item.audioEqLowEnabled,
    audioEqLowType: item.audioEqLowType,
    audioEqLowGainDb:
      item.audioEqLowGainDb === undefined ? undefined : clampAudioEqGainDb(item.audioEqLowGainDb),
    audioEqLowFrequencyHz:
      item.audioEqLowFrequencyHz === undefined
        ? undefined
        : clampAudioEqFrequencyHz(
            item.audioEqLowFrequencyHz,
            AUDIO_EQ_LOW_MIN_FREQUENCY_HZ,
            AUDIO_EQ_LOW_MAX_FREQUENCY_HZ,
            AUDIO_EQ_LOW_FREQUENCY_HZ,
          ),
    audioEqLowQ:
      item.audioEqLowQ === undefined
        ? undefined
        : clampAudioEqQ(item.audioEqLowQ, AUDIO_EQ_LOW_MID_Q),
    audioEqLowMidEnabled:
      item.audioEqLowMidEnabled === undefined ? undefined : !!item.audioEqLowMidEnabled,
    audioEqLowMidType: item.audioEqLowMidType,
    audioEqLowMidGainDb:
      item.audioEqLowMidGainDb === undefined
        ? undefined
        : clampAudioEqGainDb(item.audioEqLowMidGainDb),
    audioEqLowMidFrequencyHz:
      item.audioEqLowMidFrequencyHz === undefined
        ? undefined
        : clampAudioEqFrequencyHz(
            item.audioEqLowMidFrequencyHz,
            AUDIO_EQ_LOW_MID_MIN_FREQUENCY_HZ,
            AUDIO_EQ_LOW_MID_MAX_FREQUENCY_HZ,
            AUDIO_EQ_LOW_MID_FREQUENCY_HZ,
          ),
    audioEqLowMidQ:
      item.audioEqLowMidQ === undefined
        ? undefined
        : clampAudioEqQ(item.audioEqLowMidQ, AUDIO_EQ_LOW_MID_Q),
    audioEqMidGainDb:
      item.audioEqMidGainDb === undefined ? undefined : clampAudioEqGainDb(item.audioEqMidGainDb),
    audioEqHighMidEnabled:
      item.audioEqHighMidEnabled === undefined ? undefined : !!item.audioEqHighMidEnabled,
    audioEqHighMidType: item.audioEqHighMidType,
    audioEqHighMidGainDb:
      item.audioEqHighMidGainDb === undefined
        ? undefined
        : clampAudioEqGainDb(item.audioEqHighMidGainDb),
    audioEqHighMidFrequencyHz:
      item.audioEqHighMidFrequencyHz === undefined
        ? undefined
        : clampAudioEqFrequencyHz(
            item.audioEqHighMidFrequencyHz,
            AUDIO_EQ_HIGH_MID_MIN_FREQUENCY_HZ,
            AUDIO_EQ_HIGH_MID_MAX_FREQUENCY_HZ,
            AUDIO_EQ_HIGH_MID_FREQUENCY_HZ,
          ),
    audioEqHighMidQ:
      item.audioEqHighMidQ === undefined
        ? undefined
        : clampAudioEqQ(item.audioEqHighMidQ, AUDIO_EQ_HIGH_MID_Q),
    audioEqHighEnabled:
      item.audioEqHighEnabled === undefined ? undefined : !!item.audioEqHighEnabled,
    audioEqHighType: item.audioEqHighType,
    audioEqHighGainDb:
      item.audioEqHighGainDb === undefined ? undefined : clampAudioEqGainDb(item.audioEqHighGainDb),
    audioEqHighFrequencyHz:
      item.audioEqHighFrequencyHz === undefined
        ? undefined
        : clampAudioEqFrequencyHz(
            item.audioEqHighFrequencyHz,
            AUDIO_EQ_HIGH_MIN_FREQUENCY_HZ,
            AUDIO_EQ_HIGH_MAX_FREQUENCY_HZ,
            AUDIO_EQ_HIGH_FREQUENCY_HZ,
          ),
    audioEqHighQ:
      item.audioEqHighQ === undefined
        ? undefined
        : clampAudioEqQ(item.audioEqHighQ, AUDIO_EQ_HIGH_MID_Q),
    audioEqBand6Enabled:
      item.audioEqBand6Enabled === undefined ? undefined : !!item.audioEqBand6Enabled,
    audioEqBand6Type: item.audioEqBand6Type,
    audioEqBand6FrequencyHz:
      item.audioEqBand6FrequencyHz === undefined
        ? undefined
        : clampAudioEqFrequencyHz(
            item.audioEqBand6FrequencyHz,
            AUDIO_EQ_HIGH_CUT_MIN_FREQUENCY_HZ,
            AUDIO_EQ_HIGH_CUT_MAX_FREQUENCY_HZ,
            AUDIO_EQ_HIGH_CUT_FREQUENCY_HZ,
          ),
    audioEqBand6GainDb:
      item.audioEqBand6GainDb === undefined
        ? undefined
        : clampAudioEqGainDb(item.audioEqBand6GainDb),
    audioEqBand6Q:
      item.audioEqBand6Q === undefined
        ? undefined
        : clampAudioEqQ(item.audioEqBand6Q, AUDIO_EQ_HIGH_MID_Q),
    audioEqBand6SlopeDbPerOct:
      item.audioEqBand6SlopeDbPerOct === undefined
        ? undefined
        : clampAudioEqCutSlopeDbPerOct(item.audioEqBand6SlopeDbPerOct),
    audioEqHighCutEnabled:
      item.audioEqHighCutEnabled === undefined ? undefined : !!item.audioEqHighCutEnabled,
    audioEqHighCutFrequencyHz:
      item.audioEqHighCutFrequencyHz === undefined
        ? undefined
        : clampAudioEqFrequencyHz(
            item.audioEqHighCutFrequencyHz,
            AUDIO_EQ_HIGH_CUT_MIN_FREQUENCY_HZ,
            AUDIO_EQ_HIGH_CUT_MAX_FREQUENCY_HZ,
            AUDIO_EQ_HIGH_CUT_FREQUENCY_HZ,
          ),
    audioEqHighCutSlopeDbPerOct:
      item.audioEqHighCutSlopeDbPerOct === undefined
        ? undefined
        : clampAudioEqCutSlopeDbPerOct(item.audioEqHighCutSlopeDbPerOct),
  }

  if (normalized.cornerPin) {
    const cornerPinTargetRect = resolveCornerPinTargetRect(
      normalized.transform?.width ?? 0,
      normalized.transform?.height ?? 0,
      normalized.type === 'video' || normalized.type === 'image'
        ? {
            sourceWidth: normalized.sourceWidth,
            sourceHeight: normalized.sourceHeight,
            crop: normalized.crop,
          }
        : undefined,
    )
    normalized.cornerPin = {
      ...normalized.cornerPin,
      referenceWidth:
        normalized.cornerPin.referenceWidth ??
        (cornerPinTargetRect.width > 0 ? cornerPinTargetRect.width : undefined),
      referenceHeight:
        normalized.cornerPin.referenceHeight ??
        (cornerPinTargetRect.height > 0 ? cornerPinTargetRect.height : undefined),
    }
  }

  if (normalized.type === 'shape' && normalized.isMask) {
    normalized.blendMode = 'normal'
  }

  // Legacy split clips can have sourceEnd without sourceStart.
  // Treat them as explicitly bounded from 0 to sourceEnd so rate stretch
  // operates on the split segment rather than the full media duration.
  if (
    (normalized.type === 'video' || normalized.type === 'audio') &&
    normalized.sourceEnd !== undefined &&
    normalized.sourceStart === undefined
  ) {
    normalized.sourceStart = 0
  }

  return normalized as T
}

function normalizeItemUpdates(updates: Partial<TimelineItem>): Partial<TimelineItem> {
  const normalized = { ...updates } as Partial<TimelineItem>

  if (normalized.from !== undefined) normalized.from = roundFrame(normalized.from)
  if (normalized.durationInFrames !== undefined)
    normalized.durationInFrames = roundDuration(normalized.durationInFrames)
  if (normalized.trimStart !== undefined) normalized.trimStart = roundFrame(normalized.trimStart)
  if (normalized.trimEnd !== undefined) normalized.trimEnd = roundFrame(normalized.trimEnd)
  if (normalized.sourceStart !== undefined)
    normalized.sourceStart = roundFrame(normalized.sourceStart)
  if (normalized.sourceEnd !== undefined) normalized.sourceEnd = roundFrame(normalized.sourceEnd)
  if (normalized.sourceDuration !== undefined)
    normalized.sourceDuration = roundFrame(normalized.sourceDuration)
  if (normalized.sourceFps !== undefined)
    normalized.sourceFps = normalizeOptionalFps(normalized.sourceFps)
  if (normalized.crop !== undefined) normalized.crop = normalizeCropSettings(normalized.crop)

  // Keep legacy end-only bounds explicit and stable.
  if (normalized.sourceEnd !== undefined && normalized.sourceStart === undefined) {
    normalized.sourceStart = 0
  }

  if (normalized.audioFadeInCurve !== undefined) {
    normalized.audioFadeInCurve = clampAudioFadeCurve(normalized.audioFadeInCurve)
  }
  if (normalized.audioFadeOutCurve !== undefined) {
    normalized.audioFadeOutCurve = clampAudioFadeCurve(normalized.audioFadeOutCurve)
  }
  if (normalized.audioFadeInCurveX !== undefined) {
    normalized.audioFadeInCurveX = clampAudioFadeCurveX(normalized.audioFadeInCurveX)
  }
  if (normalized.audioFadeOutCurveX !== undefined) {
    normalized.audioFadeOutCurveX = clampAudioFadeCurveX(normalized.audioFadeOutCurveX)
  }
  if (normalized.audioPitchSemitones !== undefined) {
    normalized.audioPitchSemitones = clampAudioPitchSemitones(normalized.audioPitchSemitones)
  }
  if (normalized.audioPitchCents !== undefined) {
    normalized.audioPitchCents = clampAudioPitchCents(normalized.audioPitchCents)
  }
  if (normalized.audioEqOutputGainDb !== undefined) {
    normalized.audioEqOutputGainDb = clampAudioEqGainDb(normalized.audioEqOutputGainDb)
  }
  if (normalized.audioEqBand1Enabled !== undefined) {
    normalized.audioEqBand1Enabled = !!normalized.audioEqBand1Enabled
  }
  if (normalized.audioEqBand1FrequencyHz !== undefined) {
    normalized.audioEqBand1FrequencyHz = clampAudioEqFrequencyHz(
      normalized.audioEqBand1FrequencyHz,
      AUDIO_EQ_LOW_CUT_MIN_FREQUENCY_HZ,
      AUDIO_EQ_LOW_CUT_MAX_FREQUENCY_HZ,
      AUDIO_EQ_LOW_CUT_FREQUENCY_HZ,
    )
  }
  if (normalized.audioEqBand1GainDb !== undefined) {
    normalized.audioEqBand1GainDb = clampAudioEqGainDb(normalized.audioEqBand1GainDb)
  }
  if (normalized.audioEqBand1Q !== undefined) {
    normalized.audioEqBand1Q = clampAudioEqQ(normalized.audioEqBand1Q, AUDIO_EQ_LOW_MID_Q)
  }
  if (normalized.audioEqBand1SlopeDbPerOct !== undefined) {
    normalized.audioEqBand1SlopeDbPerOct = clampAudioEqCutSlopeDbPerOct(
      normalized.audioEqBand1SlopeDbPerOct,
    )
  }
  if (normalized.audioEqLowCutEnabled !== undefined) {
    normalized.audioEqLowCutEnabled = !!normalized.audioEqLowCutEnabled
  }
  if (normalized.audioEqLowCutFrequencyHz !== undefined) {
    normalized.audioEqLowCutFrequencyHz = clampAudioEqFrequencyHz(
      normalized.audioEqLowCutFrequencyHz,
      AUDIO_EQ_LOW_CUT_MIN_FREQUENCY_HZ,
      AUDIO_EQ_LOW_CUT_MAX_FREQUENCY_HZ,
      AUDIO_EQ_LOW_CUT_FREQUENCY_HZ,
    )
  }
  if (normalized.audioEqLowCutSlopeDbPerOct !== undefined) {
    normalized.audioEqLowCutSlopeDbPerOct = clampAudioEqCutSlopeDbPerOct(
      normalized.audioEqLowCutSlopeDbPerOct,
    )
  }
  if (normalized.audioEqLowEnabled !== undefined) {
    normalized.audioEqLowEnabled = !!normalized.audioEqLowEnabled
  }
  if (normalized.audioEqLowGainDb !== undefined) {
    normalized.audioEqLowGainDb = clampAudioEqGainDb(normalized.audioEqLowGainDb)
  }
  if (normalized.audioEqLowFrequencyHz !== undefined) {
    normalized.audioEqLowFrequencyHz = clampAudioEqFrequencyHz(
      normalized.audioEqLowFrequencyHz,
      AUDIO_EQ_LOW_MIN_FREQUENCY_HZ,
      AUDIO_EQ_LOW_MAX_FREQUENCY_HZ,
      AUDIO_EQ_LOW_FREQUENCY_HZ,
    )
  }
  if (normalized.audioEqLowQ !== undefined) {
    normalized.audioEqLowQ = clampAudioEqQ(normalized.audioEqLowQ, AUDIO_EQ_LOW_MID_Q)
  }
  if (normalized.audioEqLowMidEnabled !== undefined) {
    normalized.audioEqLowMidEnabled = !!normalized.audioEqLowMidEnabled
  }
  if (normalized.audioEqLowMidGainDb !== undefined) {
    normalized.audioEqLowMidGainDb = clampAudioEqGainDb(normalized.audioEqLowMidGainDb)
  }
  if (normalized.audioEqLowMidFrequencyHz !== undefined) {
    normalized.audioEqLowMidFrequencyHz = clampAudioEqFrequencyHz(
      normalized.audioEqLowMidFrequencyHz,
      AUDIO_EQ_LOW_MID_MIN_FREQUENCY_HZ,
      AUDIO_EQ_LOW_MID_MAX_FREQUENCY_HZ,
      AUDIO_EQ_LOW_MID_FREQUENCY_HZ,
    )
  }
  if (normalized.audioEqLowMidQ !== undefined) {
    normalized.audioEqLowMidQ = clampAudioEqQ(normalized.audioEqLowMidQ, AUDIO_EQ_LOW_MID_Q)
  }
  if (normalized.audioEqMidGainDb !== undefined) {
    normalized.audioEqMidGainDb = clampAudioEqGainDb(normalized.audioEqMidGainDb)
  }
  if (normalized.audioEqHighMidEnabled !== undefined) {
    normalized.audioEqHighMidEnabled = !!normalized.audioEqHighMidEnabled
  }
  if (normalized.audioEqHighMidGainDb !== undefined) {
    normalized.audioEqHighMidGainDb = clampAudioEqGainDb(normalized.audioEqHighMidGainDb)
  }
  if (normalized.audioEqHighMidFrequencyHz !== undefined) {
    normalized.audioEqHighMidFrequencyHz = clampAudioEqFrequencyHz(
      normalized.audioEqHighMidFrequencyHz,
      AUDIO_EQ_HIGH_MID_MIN_FREQUENCY_HZ,
      AUDIO_EQ_HIGH_MID_MAX_FREQUENCY_HZ,
      AUDIO_EQ_HIGH_MID_FREQUENCY_HZ,
    )
  }
  if (normalized.audioEqHighMidQ !== undefined) {
    normalized.audioEqHighMidQ = clampAudioEqQ(normalized.audioEqHighMidQ, AUDIO_EQ_HIGH_MID_Q)
  }
  if (normalized.audioEqHighEnabled !== undefined) {
    normalized.audioEqHighEnabled = !!normalized.audioEqHighEnabled
  }
  if (normalized.audioEqHighGainDb !== undefined) {
    normalized.audioEqHighGainDb = clampAudioEqGainDb(normalized.audioEqHighGainDb)
  }
  if (normalized.audioEqHighFrequencyHz !== undefined) {
    normalized.audioEqHighFrequencyHz = clampAudioEqFrequencyHz(
      normalized.audioEqHighFrequencyHz,
      AUDIO_EQ_HIGH_MIN_FREQUENCY_HZ,
      AUDIO_EQ_HIGH_MAX_FREQUENCY_HZ,
      AUDIO_EQ_HIGH_FREQUENCY_HZ,
    )
  }
  if (normalized.audioEqHighQ !== undefined) {
    normalized.audioEqHighQ = clampAudioEqQ(normalized.audioEqHighQ, AUDIO_EQ_HIGH_MID_Q)
  }
  if (normalized.audioEqBand6Enabled !== undefined) {
    normalized.audioEqBand6Enabled = !!normalized.audioEqBand6Enabled
  }
  if (normalized.audioEqBand6FrequencyHz !== undefined) {
    normalized.audioEqBand6FrequencyHz = clampAudioEqFrequencyHz(
      normalized.audioEqBand6FrequencyHz,
      AUDIO_EQ_HIGH_CUT_MIN_FREQUENCY_HZ,
      AUDIO_EQ_HIGH_CUT_MAX_FREQUENCY_HZ,
      AUDIO_EQ_HIGH_CUT_FREQUENCY_HZ,
    )
  }
  if (normalized.audioEqBand6GainDb !== undefined) {
    normalized.audioEqBand6GainDb = clampAudioEqGainDb(normalized.audioEqBand6GainDb)
  }
  if (normalized.audioEqBand6Q !== undefined) {
    normalized.audioEqBand6Q = clampAudioEqQ(normalized.audioEqBand6Q, AUDIO_EQ_HIGH_MID_Q)
  }
  if (normalized.audioEqBand6SlopeDbPerOct !== undefined) {
    normalized.audioEqBand6SlopeDbPerOct = clampAudioEqCutSlopeDbPerOct(
      normalized.audioEqBand6SlopeDbPerOct,
    )
  }
  if (normalized.audioEqHighCutEnabled !== undefined) {
    normalized.audioEqHighCutEnabled = !!normalized.audioEqHighCutEnabled
  }
  if (normalized.audioEqHighCutFrequencyHz !== undefined) {
    normalized.audioEqHighCutFrequencyHz = clampAudioEqFrequencyHz(
      normalized.audioEqHighCutFrequencyHz,
      AUDIO_EQ_HIGH_CUT_MIN_FREQUENCY_HZ,
      AUDIO_EQ_HIGH_CUT_MAX_FREQUENCY_HZ,
      AUDIO_EQ_HIGH_CUT_FREQUENCY_HZ,
    )
  }
  if (normalized.audioEqHighCutSlopeDbPerOct !== undefined) {
    normalized.audioEqHighCutSlopeDbPerOct = clampAudioEqCutSlopeDbPerOct(
      normalized.audioEqHighCutSlopeDbPerOct,
    )
  }

  return normalized
}

function normalizeTrack(track: TimelineTrack): TimelineTrack {
  return {
    ...track,
    volume: track.volume === undefined ? undefined : Math.max(-60, Math.min(12, track.volume)),
    audioEq: normalizeAudioEqSettings(track.audioEq),
  }
}

function areItemArraysEqual(a: TimelineItem[] | undefined, b: TimelineItem[]): boolean {
  if (!a || a.length !== b.length) return false
  for (let i = 0; i < b.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

function buildItemsByTrackId(
  items: TimelineItem[],
  previous: Record<string, TimelineItem[]>,
): Record<string, TimelineItem[]> {
  const grouped: Record<string, TimelineItem[]> = {}
  for (const item of items) {
    ;(grouped[item.trackId] ??= []).push(item)
  }

  const next: Record<string, TimelineItem[]> = {}
  for (const [trackId, trackItems] of Object.entries(grouped)) {
    const previousTrackItems = previous[trackId]
    next[trackId] =
      previousTrackItems && areItemArraysEqual(previousTrackItems, trackItems)
        ? previousTrackItems
        : trackItems
  }

  return next
}

function buildItemsByLinkedGroupId(
  items: TimelineItem[],
  previous: Record<string, TimelineItem[]>,
): Record<string, TimelineItem[]> {
  const grouped: Record<string, TimelineItem[]> = {}
  for (const item of items) {
    if (item.linkedGroupId) {
      ;(grouped[item.linkedGroupId] ??= []).push(item)
    }
  }

  const next: Record<string, TimelineItem[]> = {}
  for (const [groupId, groupItems] of Object.entries(grouped)) {
    const previousGroupItems = previous[groupId]
    next[groupId] =
      previousGroupItems && areItemArraysEqual(previousGroupItems, groupItems)
        ? previousGroupItems
        : groupItems
  }

  return next
}

function isCaptionableClip(item: TimelineItem): item is AudioItem | VideoItem {
  return (
    (item.type === 'audio' || item.type === 'video') &&
    typeof item.mediaId === 'string' &&
    item.mediaId.length > 0
  )
}

function isLegacyGeneratedCaptionItem(item: TimelineItem): item is TextItem {
  const plainText = item.type === 'text' ? getTextItemPlainText(item) : ''
  return (
    item.type === 'text' &&
    !item.captionSource &&
    typeof item.mediaId === 'string' &&
    item.mediaId.length > 0 &&
    plainText.trim().length > 0 &&
    item.label === plainText.slice(0, 48)
  )
}

function buildReplaceableCaptionClipIds(items: TimelineItem[]): Set<string> {
  const ids = new Set<string>()
  const clipsByMediaId: Record<string, Array<AudioItem | VideoItem>> = {}

  for (const item of items) {
    if (
      item.type === 'text' &&
      item.captionSource?.type === 'transcript' &&
      item.captionSource.clipId
    ) {
      ids.add(item.captionSource.clipId)
      continue
    }

    if (isCaptionableClip(item)) {
      const mediaId = item.mediaId
      if (!mediaId) continue
      ;(clipsByMediaId[mediaId] ??= []).push(item)
    }
  }

  for (const clips of Object.values(clipsByMediaId)) {
    clips.sort((left, right) => left.from - right.from)
  }

  for (const item of items) {
    if (!isLegacyGeneratedCaptionItem(item) || !item.mediaId) {
      continue
    }

    const mediaId = item.mediaId
    const itemEnd = item.from + item.durationInFrames
    const candidateClips = clipsByMediaId[mediaId]
    if (!candidateClips) {
      continue
    }

    for (const clip of candidateClips) {
      if (clip.from > item.from) {
        break
      }

      const clipEnd = clip.from + clip.durationInFrames
      if (item.from >= clip.from && itemEnd <= clipEnd) {
        ids.add(clip.id)
      }
    }
  }

  return ids
}

function isMediaPair(left: TimelineItem, right: TimelineItem): boolean {
  return (
    (left.type === 'video' && right.type === 'audio') ||
    (left.type === 'audio' && right.type === 'video')
  )
}

function isLegacyLinkCandidate(item: TimelineItem): item is AudioItem | VideoItem {
  return (
    !item.linkedGroupId &&
    isCaptionableClip(item) &&
    typeof item.originId === 'string' &&
    item.originId.length > 0
  )
}

function isLegacyLinkedPair(anchor: TimelineItem, candidate: TimelineItem): boolean {
  if (!isMediaPair(anchor, candidate)) return false
  if (!anchor.originId || anchor.originId !== candidate.originId) return false
  if (!anchor.mediaId || anchor.mediaId !== candidate.mediaId) return false
  return anchor.from === candidate.from && anchor.durationInFrames === candidate.durationInFrames
}

function buildLinkedItemsByItemId(
  items: TimelineItem[],
  itemsByLinkedGroupId: Record<string, TimelineItem[]>,
  previous: Record<string, TimelineItem[]>,
): Record<string, TimelineItem[]> {
  const next: Record<string, TimelineItem[]> = {}

  for (const groupItems of Object.values(itemsByLinkedGroupId)) {
    if (groupItems.length <= 1) {
      continue
    }

    for (const item of groupItems) {
      next[item.id] = groupItems
    }
  }

  const legacyGroups: Record<string, TimelineItem[]> = {}
  for (const item of items) {
    if (!isLegacyLinkCandidate(item)) {
      continue
    }

    const key = `${item.originId}|${item.mediaId}|${item.from}|${item.durationInFrames}`
    ;(legacyGroups[key] ??= []).push(item)
  }

  for (const groupItems of Object.values(legacyGroups)) {
    if (groupItems.length <= 1) {
      continue
    }

    for (const anchor of groupItems) {
      const linkedItems = groupItems.filter(
        (candidate) => candidate.id === anchor.id || isLegacyLinkedPair(anchor, candidate),
      )

      if (linkedItems.length <= 1) {
        continue
      }

      const previousLinkedItems = previous[anchor.id]
      next[anchor.id] =
        previousLinkedItems && areItemArraysEqual(previousLinkedItems, linkedItems)
          ? previousLinkedItems
          : linkedItems
    }
  }

  return next
}

function buildItemById(
  items: TimelineItem[],
  previous: Record<string, TimelineItem>,
): Record<string, TimelineItem> {
  const next: Record<string, TimelineItem> = {}
  for (const item of items) {
    const previousItem = previous[item.id]
    next[item.id] = previousItem !== undefined && previousItem === item ? previousItem : item
  }
  return next
}

function buildItemsMediaDependencyIds(items: TimelineItem[]): string[] {
  const mediaIds = new Set<string>()
  for (const item of items) {
    if (item.mediaId) {
      mediaIds.add(item.mediaId)
    }
  }
  return [...mediaIds].sort()
}

function buildMediaDependencyKey(mediaDependencyIds: string[]): string {
  return mediaDependencyIds.join('|')
}

function computeMaxItemEndFrame(items: TimelineItem[]): number {
  let max = 0
  for (const item of items) {
    const end = item.from + item.durationInFrames
    if (end > max) max = end
  }
  return max
}

function withItemIndexes(
  items: TimelineItem[],
  previous: Pick<
    ItemsState,
    'itemsByTrackId' | 'itemById' | 'itemsByLinkedGroupId' | 'linkedItemsByItemId'
  >,
): Pick<
  ItemsState,
  | 'items'
  | 'itemsByTrackId'
  | 'itemById'
  | 'itemsByLinkedGroupId'
  | 'linkedItemsByItemId'
  | 'replaceableCaptionClipIds'
  | 'maxItemEndFrame'
> {
  const itemsByLinkedGroupId = buildItemsByLinkedGroupId(items, previous.itemsByLinkedGroupId)
  return {
    items,
    itemsByTrackId: buildItemsByTrackId(items, previous.itemsByTrackId),
    itemById: buildItemById(items, previous.itemById),
    itemsByLinkedGroupId,
    linkedItemsByItemId: buildLinkedItemsByItemId(
      items,
      itemsByLinkedGroupId,
      previous.linkedItemsByItemId,
    ),
    replaceableCaptionClipIds: buildReplaceableCaptionClipIds(items),
    maxItemEndFrame: computeMaxItemEndFrame(items),
  }
}

/**
 * Get IDs of clips that have a transition with the given item.
 * These clips are allowed to overlap during trim operations.
 */
function getTransitionLinkedIds(itemId: string): Set<string> {
  const transitions = useTransitionsStore.getState().transitions
  const linkedIds = new Set<string>()
  for (const t of transitions) {
    if (t.leftClipId === itemId) linkedIds.add(t.rightClipId)
    if (t.rightClipId === itemId) linkedIds.add(t.leftClipId)
  }
  return linkedIds
}

function buildRippleShiftByItemId(
  items: TimelineItem[],
  deletedItems: TimelineItem[],
): Map<string, number> {
  const shiftByItemId = new Map<string, number>()

  for (const item of items) {
    let shiftAmount = 0
    for (const deletedItem of deletedItems) {
      if (
        deletedItem.trackId === item.trackId &&
        deletedItem.from + deletedItem.durationInFrames <= item.from
      ) {
        shiftAmount += deletedItem.durationInFrames
      }
    }
    shiftByItemId.set(item.id, shiftAmount)
  }

  const visited = new Set<string>()
  for (const item of items) {
    if (visited.has(item.id)) continue

    const linkedItems = getLinkedItems(items, item.id)
    for (const linkedItem of linkedItems) {
      visited.add(linkedItem.id)
    }

    if (linkedItems.length <= 1) continue

    let groupShift = 0
    for (const linkedItem of linkedItems) {
      groupShift = Math.max(groupShift, shiftByItemId.get(linkedItem.id) ?? 0)
    }

    if (groupShift <= 0) continue

    for (const linkedItem of linkedItems) {
      shiftByItemId.set(linkedItem.id, groupShift)
    }
  }

  return shiftByItemId
}

/**
 * Items state - timeline clips/items and tracks.
 * This is the core timeline content. Complex cross-domain operations
 * (like removeItems which cascades to transitions/keyframes) are handled
 * by timeline-actions.ts using the command system.
 */

interface ItemsState {
  items: TimelineItem[]
  itemsByTrackId: Record<string, TimelineItem[]>
  itemById: Record<string, TimelineItem>
  itemsByLinkedGroupId: Record<string, TimelineItem[]>
  linkedItemsByItemId: Record<string, TimelineItem[]>
  /** Set of clip IDs that can regenerate captions, including legacy generated captions */
  replaceableCaptionClipIds: Set<string>
  maxItemEndFrame: number
  mediaDependencyIds: string[]
  mediaDependencyVersion: number
  tracks: TimelineTrack[]
}

interface ItemsActions {
  // Bulk setters for snapshot restore
  setItems: (items: TimelineItem[]) => void
  setTracks: (tracks: TimelineTrack[]) => void

  // Internal mutations (prefixed with _ to indicate called by command system)
  _addItem: (item: TimelineItem) => void
  _addItems: (items: TimelineItem[]) => void
  _updateItem: (id: string, updates: Partial<TimelineItem>) => void
  _removeItems: (ids: string[]) => void

  // Specialized item operations
  _rippleDeleteItems: (ids: string[]) => void
  _closeGapAtPosition: (trackId: string, frame: number) => void
  _moveItem: (id: string, newFrom: number, newTrackId?: string) => void
  _moveItems: (updates: Array<{ id: string; from: number; trackId?: string }>) => void
  _duplicateItems: (
    itemIds: string[],
    positions: Array<{ from: number; trackId: string }>,
  ) => TimelineItem[]
  _trimItemStart: (
    id: string,
    trimAmount: number,
    options?: { skipAdjacentClamp?: boolean },
  ) => void
  _trimItemEnd: (id: string, trimAmount: number, options?: { skipAdjacentClamp?: boolean }) => void
  _splitItem: (
    id: string,
    splitFrame: number,
  ) => { leftItem: TimelineItem; rightItem: TimelineItem } | null
  _joinItems: (itemIds: string[]) => void
  _rateStretchItem: (id: string, newFrom: number, newDuration: number, newSpeed: number) => void

  // Transform operations
  _updateItemTransform: (id: string, transform: Partial<TransformProperties>) => void
  _resetItemTransform: (id: string) => void
  _updateItemsTransform: (ids: string[], transform: Partial<TransformProperties>) => void
  _updateItemsTransformMap: (transformsMap: Map<string, Partial<TransformProperties>>) => void

  // Effect operations
  _addEffect: (itemId: string, effect: VisualEffect) => void
  _addEffects: (updates: Array<{ itemId: string; effects: VisualEffect[] }>) => void
  _updateEffect: (
    itemId: string,
    effectId: string,
    updates: Partial<{ effect: VisualEffect; enabled: boolean }>,
  ) => void
  _removeEffect: (itemId: string, effectId: string) => void
  _toggleEffect: (itemId: string, effectId: string) => void
}

export const useItemsStore = create<ItemsState & ItemsActions>()((set, get) => ({
  // State
  items: [],
  itemsByTrackId: {},
  itemById: {},
  itemsByLinkedGroupId: {},
  linkedItemsByItemId: {},
  replaceableCaptionClipIds: new Set<string>(),
  maxItemEndFrame: 0,
  mediaDependencyIds: [],
  mediaDependencyVersion: 0,
  tracks: [],

  // Bulk setters
  setItems: (items) =>
    set((state) => {
      const normalizedItems = items.map((item) => normalizeFrameFields(item))
      return withItemIndexes(normalizedItems, state)
    }),
  setTracks: (tracks) =>
    set({
      tracks: [...tracks]
        .map((track) => normalizeTrack(track))
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    }),

  // Add item
  _addItem: (item) =>
    set((state) => {
      const nextItems = [...state.items, normalizeFrameFields(item)]
      return withItemIndexes(nextItems, state)
    }),

  // Add multiple items in one mutation
  _addItems: (items) =>
    set((state) => {
      const nextItems = [...state.items, ...items.map((item) => normalizeFrameFields(item))]
      return withItemIndexes(nextItems, state)
    }),

  // Update item
  _updateItem: (id, updates) => {
    const normalizedUpdates = normalizeItemUpdates(updates)
    return set((state) => {
      const nextItems = state.items.map((i) =>
        i.id === id ? normalizeFrameFields({ ...i, ...normalizedUpdates } as typeof i) : i,
      )
      return withItemIndexes(nextItems, state)
    })
  },

  // Remove items (simple - cascade handled by timeline-actions)
  _removeItems: (ids) =>
    set((state) => {
      const idsSet = new Set(ids)
      const nextItems = state.items.filter((i) => !idsSet.has(i.id))
      return withItemIndexes(nextItems, state)
    }),

  // Ripple delete: remove items AND shift subsequent items to close gaps
  _rippleDeleteItems: (ids) =>
    set((state) => {
      const idsToDelete = new Set(ids)
      const itemsToDelete = state.items.filter((i) => idsToDelete.has(i.id))

      if (itemsToDelete.length === 0) return state

      const remainingItems = state.items.filter((i) => !idsToDelete.has(i.id))
      const shiftByItemId = buildRippleShiftByItemId(remainingItems, itemsToDelete)

      const newItems = remainingItems.map((item) => {
        const shiftAmount = shiftByItemId.get(item.id) ?? 0
        return shiftAmount > 0
          ? normalizeFrameFields({ ...item, from: item.from - shiftAmount })
          : item
      })

      return withItemIndexes(newItems, state)
    }),

  // Close gap at position
  _closeGapAtPosition: (trackId, frame) =>
    set((state) => {
      const targetFrame = roundFrame(frame)
      const trackItems = state.items
        .filter((i) => i.trackId === trackId)
        .sort((a, b) => a.from - b.from)

      if (trackItems.length === 0) return state

      let gapStart = 0
      let gapEnd = 0

      for (const item of trackItems) {
        if (targetFrame >= gapStart && targetFrame < item.from) {
          gapEnd = item.from
          break
        }
        gapStart = item.from + item.durationInFrames
      }

      if (gapEnd <= gapStart) return state

      const gapSize = gapEnd - gapStart
      const newItems = state.items.map((item) => {
        if (item.trackId === trackId && item.from >= gapEnd) {
          return normalizeFrameFields({ ...item, from: item.from - gapSize })
        }
        return item
      })

      return withItemIndexes(newItems, state)
    }),

  // Move single item
  _moveItem: (id, newFrom, newTrackId) => {
    const normalizedFrom = roundFrame(newFrom)
    return set((state) => {
      const nextItems = state.items.map((item) =>
        item.id === id
          ? normalizeFrameFields({
              ...item,
              from: normalizedFrom,
              ...(newTrackId && { trackId: newTrackId }),
            })
          : item,
      )
      return withItemIndexes(nextItems, state)
    })
  },

  // Move multiple items
  _moveItems: (updates) =>
    set((state) => {
      const updateMap = new Map(updates.map((u) => [u.id, { ...u, from: roundFrame(u.from) }]))
      const nextItems = state.items.map((item) => {
        const update = updateMap.get(item.id)
        if (!update) return item
        return normalizeFrameFields({
          ...item,
          from: update.from,
          ...(update.trackId && { trackId: update.trackId }),
        })
      })
      return withItemIndexes(nextItems, state)
    }),

  // Duplicate items
  _duplicateItems: (itemIds, positions) => {
    const state = get()
    const itemsMap = new Map(state.items.map((i) => [i.id, i]))
    const newItems: TimelineItem[] = []
    const activeCompositionId = useCompositionNavigationStore.getState().activeCompositionId
    const compositionById = useCompositionsStore.getState().compositionById
    const linkedGroupMap = new Map<string, string>()

    for (let i = 0; i < itemIds.length; i++) {
      const original = itemsMap.get(itemIds[i]!)
      const position = positions[i]!
      if (!original || !position) continue
      if (
        activeCompositionId !== null &&
        isCompositionWrapperItem(original) &&
        wouldCreateCompositionCycle({
          parentCompositionId: activeCompositionId,
          insertedCompositionId: original.compositionId,
          compositionById,
        })
      ) {
        continue
      }

      const duplicate = {
        ...original,
        id: crypto.randomUUID(),
        from: roundFrame(position.from),
        trackId: position.trackId,
        // Give duplicate a new originId so it forms its own group in StableVideoSequence.
        // Without this, split clips that are duplicated would be grouped with the originals,
        // causing incorrect sourceStart calculations (can result in negative values).
        originId: crypto.randomUUID(),
        linkedGroupId: original.linkedGroupId
          ? (linkedGroupMap.get(original.linkedGroupId) ??
            linkedGroupMap
              .set(original.linkedGroupId, crypto.randomUUID())
              .get(original.linkedGroupId))
          : undefined,
      } as TimelineItem

      newItems.push(normalizeFrameFields(duplicate))
    }

    set((state) => {
      const nextItems = [...state.items, ...newItems]
      return withItemIndexes(nextItems, state)
    })
    return newItems
  },

  // Trim item start
  _trimItemStart: (id, trimAmount, options) =>
    set((state) => {
      const nextItems = state.items.map((item) => {
        if (item.id !== id) return item

        // Clamp trim amount to source boundaries and minimum duration
        const timelineFps = useTimelineSettingsStore.getState().fps
        let { clampedAmount } = clampTrimAmount(item, 'start', trimAmount, timelineFps)
        // Clamp to adjacent items on the same track (allow overlap with transition-linked clips)
        if (!options?.skipAdjacentClamp) {
          const transitionLinkedIds = getTransitionLinkedIds(id)
          clampedAmount = clampToAdjacentItems(
            item,
            'start',
            clampedAmount,
            state.items,
            transitionLinkedIds,
          )
        }

        const newFrom = item.from + clampedAmount
        const newDuration = item.durationInFrames - clampedAmount

        if (newDuration <= 0) return item

        // Calculate source boundary updates for media items
        const sourceUpdate = calculateTrimSourceUpdate(
          item,
          'start',
          clampedAmount,
          newDuration,
          timelineFps,
        )

        return {
          ...item,
          from: roundFrame(newFrom),
          durationInFrames: roundDuration(newDuration),
          ...sourceUpdate,
        } as typeof item
      })
      return withItemIndexes(nextItems, state)
    }),

  // Trim item end
  _trimItemEnd: (id, trimAmount, options) =>
    set((state) => {
      const nextItems = state.items.map((item) => {
        if (item.id !== id) return item

        // Clamp trim amount to source boundaries and minimum duration
        const timelineFps = useTimelineSettingsStore.getState().fps
        let { clampedAmount } = clampTrimAmount(item, 'end', trimAmount, timelineFps)
        // Clamp to adjacent items on the same track (allow overlap with transition-linked clips)
        if (!options?.skipAdjacentClamp) {
          const transitionLinkedIds = getTransitionLinkedIds(id)
          clampedAmount = clampToAdjacentItems(
            item,
            'end',
            clampedAmount,
            state.items,
            transitionLinkedIds,
          )
        }

        const newDuration = item.durationInFrames + clampedAmount
        if (newDuration <= 0) return item

        // Calculate source boundary updates for media items
        const sourceUpdate = calculateTrimSourceUpdate(
          item,
          'end',
          clampedAmount,
          newDuration,
          timelineFps,
        )

        return {
          ...item,
          durationInFrames: roundDuration(newDuration),
          ...sourceUpdate,
        } as typeof item
      })
      return withItemIndexes(nextItems, state)
    }),

  // Split item at frame
  _splitItem: (id, splitFrame) => {
    const state = get()
    const item = state.items.find((i) => i.id === id)
    if (!item) return null
    const splitAt = roundFrame(splitFrame)

    const itemStart = roundFrame(item.from)
    const itemDuration = roundDuration(item.durationInFrames)
    const itemEnd = itemStart + itemDuration

    // Validate split point is within item
    if (splitAt <= itemStart || splitAt >= itemEnd) return null

    const leftDuration = splitAt - itemStart
    const rightDuration = itemEnd - splitAt
    // Ensure split siblings share a stable lineage key.
    // Legacy clips may not have originId; fall back to current item ID.
    const splitOriginId = item.originId ?? item.id

    // Create left item (keeps original ID for minimal disruption)
    const leftItem = {
      ...item,
      from: itemStart,
      originId: splitOriginId,
      durationInFrames: leftDuration,
    } as TimelineItem

    // Create right item with new ID
    const rightItem = {
      ...item,
      id: crypto.randomUUID(),
      originId: splitOriginId,
      from: splitAt,
      durationInFrames: rightDuration,
    } as TimelineItem

    // Handle sourceStart/sourceEnd for media items (accounting for speed)
    if (isMediaItem(item)) {
      const timelineFps = useTimelineSettingsStore.getState().fps
      const { sourceStart, speed, sourceFps } = getSourceProperties(item)
      const effectiveSourceFps = sourceFps ?? timelineFps
      const boundaries = calculateSplitSourceBoundaries(
        sourceStart,
        leftDuration,
        rightDuration,
        speed,
        timelineFps,
        effectiveSourceFps,
      )

      // Explicitly set sourceStart on left item so it has full explicit bounds.
      // Without this, the left item inherits undefined sourceStart from the original,
      // breaking hasExplicitSourceBounds detection in _rateStretchItem and causing
      // rate stretch to use the wrong source duration (full media instead of clip portion).
      ;(leftItem as typeof item).sourceStart = sourceStart
      ;(leftItem as typeof item).sourceEnd = boundaries.left.sourceEnd
      ;(rightItem as typeof item).sourceStart = boundaries.right.sourceStart
      ;(rightItem as typeof item).sourceEnd = boundaries.right.sourceEnd

      getLog().debug(
        `_splitItem: Original sourceStart:${sourceStart} speed:${speed} leftDuration:${leftDuration} rightDuration:${rightDuration}`,
      )
      getLog().debug(
        `_splitItem: boundaries.right.sourceStart:${boundaries.right.sourceStart} rightItem.sourceStart:${(rightItem as typeof item).sourceStart}`,
      )
    }

    set((state) => {
      const nextItems = state.items
        .map((i) => (i.id === id ? normalizeFrameFields(leftItem) : i))
        .concat(normalizeFrameFields(rightItem))
      return withItemIndexes(nextItems, state)
    })

    return { leftItem: normalizeFrameFields(leftItem), rightItem: normalizeFrameFields(rightItem) }
  },

  // Join items
  _joinItems: (itemIds) =>
    set((state) => {
      if (itemIds.length < 2) return state

      const itemsToJoin = state.items
        .filter((i) => itemIds.includes(i.id))
        .sort((a, b) => a.from - b.from)

      if (itemsToJoin.length < 2) return state

      // All items must be same type and track
      const firstItem = itemsToJoin[0]!
      const lastItem = itemsToJoin[itemsToJoin.length - 1]!
      const allSameType = itemsToJoin.every((i) => i.type === firstItem.type)
      const allSameTrack = itemsToJoin.every((i) => i.trackId === firstItem.trackId)

      if (!allSameType || !allSameTrack) return state

      // Calculate total duration
      const totalDuration = lastItem.from + lastItem.durationInFrames - firstItem.from

      // Create joined item (using first item as base, but take source/trim end bounds from last item)
      // This is the inverse of split: first item provides start bounds, last item provides end bounds
      const joinedItem = {
        ...firstItem,
        from: roundFrame(firstItem.from),
        durationInFrames: roundDuration(totalDuration),
        // Take sourceEnd and trimEnd from the last item to maintain source continuity
        sourceEnd: lastItem.sourceEnd,
        trimEnd: lastItem.trimEnd,
      } as TimelineItem

      // Remove all but first (by timeline position), update first
      const idsToRemove = new Set(itemsToJoin.slice(1).map((i) => i.id))
      const nextItems = state.items
        .filter((i) => !idsToRemove.has(i.id))
        .map((i) => (i.id === firstItem.id ? normalizeFrameFields(joinedItem) : i))
      return withItemIndexes(nextItems, state)
    }),

  // Rate stretch item (video, audio, or GIF)
  _rateStretchItem: (id, newFrom, newDuration, newSpeed) =>
    set((state) => {
      const nextItems = state.items.map((item) => {
        if (item.id !== id) return item
        // Allow video, audio, compositions, and GIF images (detected by .gif extension)
        const isGif = item.type === 'image' && item.label?.toLowerCase().endsWith('.gif')
        if (item.type !== 'video' && item.type !== 'audio' && item.type !== 'composition' && !isGif)
          return item

        // For clips with explicit source bounds (split clips and trimmed segments),
        // preserve sourceStart/sourceEnd exactly and only retime via speed+duration.
        // Recomputing sourceEnd here causes destructive source-span drift over repeated
        // rate-stretch operations.
        const hasExplicitSourceBounds =
          (item.type === 'video' || item.type === 'audio' || item.type === 'composition') &&
          item.sourceEnd !== undefined

        const sourceStart = item.sourceStart ?? 0
        const timelineFps = useTimelineSettingsStore.getState().fps
        const sourceFps = item.sourceFps ?? timelineFps
        const finalDuration = roundDuration(newDuration)
        let finalSpeed = newSpeed

        if (hasExplicitSourceBounds) {
          // Explicit bounds mean the source span is fixed; derive speed from that span.
          const fixedSourceSpan = Math.max(1, (item.sourceEnd ?? sourceStart) - sourceStart)
          finalSpeed = clampSpeed(
            calculateSpeed(fixedSourceSpan, finalDuration, sourceFps, timelineFps),
          )
        }

        // Recalculate sourceEnd only when bounds are not explicitly defined.
        const sourceFramesNeeded = timelineToSourceFrames(
          finalDuration,
          finalSpeed,
          timelineFps,
          sourceFps,
        )
        const newSourceEnd = sourceStart + sourceFramesNeeded
        const clampedSourceEnd = item.sourceDuration
          ? Math.min(newSourceEnd, item.sourceDuration)
          : newSourceEnd

        const updatedItem = {
          ...item,
          from: roundFrame(newFrom),
          durationInFrames: finalDuration,
          speed: finalSpeed,
        } as typeof item

        if (!hasExplicitSourceBounds) {
          updatedItem.sourceEnd = roundFrame(clampedSourceEnd)
        }

        return updatedItem
      })
      return withItemIndexes(nextItems, state)
    }),

  // Update item transform
  _updateItemTransform: (id, transform) =>
    set((state) => {
      const nextItems = state.items.map((item) => {
        if (item.id !== id) return item
        if (!('transform' in item)) return item

        return {
          ...item,
          transform: { ...item.transform, ...transform },
        } as typeof item
      })
      return withItemIndexes(nextItems, state)
    }),

  // Reset item transform
  // Note: opacity is intentionally omitted - undefined means "use default (1.0)"
  _resetItemTransform: (id) =>
    set((state) => {
      const nextItems = state.items.map((item) => {
        if (item.id !== id) return item
        if (!('transform' in item)) return item

        const updatedItem = {
          ...item,
          transform: {
            x: 0,
            y: 0,
            scale: 1,
            rotation: 0,
            // opacity intentionally not set - defaults to 1.0
          },
        }
        return updatedItem as TimelineItem
      })
      return withItemIndexes(nextItems, state)
    }),

  // Update multiple items' transforms
  _updateItemsTransform: (ids, transform) =>
    set((state) => {
      const idsSet = new Set(ids)
      const nextItems = state.items.map((item) => {
        if (!idsSet.has(item.id)) return item
        if (!('transform' in item)) return item

        return {
          ...item,
          transform: { ...item.transform, ...transform },
        } as typeof item
      })
      return withItemIndexes(nextItems, state)
    }),

  // Update transforms from map
  _updateItemsTransformMap: (transformsMap) =>
    set((state) => {
      const nextItems = state.items.map((item) => {
        const transform = transformsMap.get(item.id)
        if (!transform) return item
        if (!('transform' in item)) return item

        return {
          ...item,
          transform: { ...item.transform, ...transform },
        } as typeof item
      })
      return withItemIndexes(nextItems, state)
    }),

  // Add effect to item
  _addEffect: (itemId, effect) =>
    set((state) => {
      const nextItems = state.items.map((item) => {
        if (item.id !== itemId) return item
        // Audio items don't support visual effects
        if (item.type === 'audio') return item

        const effects = item.effects || []
        const newEffect: ItemEffect = {
          id: crypto.randomUUID(),
          effect,
          enabled: true,
        }

        return {
          ...item,
          effects: [...effects, newEffect],
        } as typeof item
      })
      return withItemIndexes(nextItems, state)
    }),

  // Add effects to multiple items
  _addEffects: (updates) =>
    set((state) => {
      const updateMap = new Map(updates.map((u) => [u.itemId, u.effects]))

      const nextItems = state.items.map((item) => {
        const effectsToAdd = updateMap.get(item.id)
        if (!effectsToAdd) return item
        // Audio items don't support visual effects
        if (item.type === 'audio') return item

        const currentEffects = item.effects || []
        const newEffects: ItemEffect[] = effectsToAdd.map((effect) => ({
          id: crypto.randomUUID(),
          effect,
          enabled: true,
        }))

        return {
          ...item,
          effects: [...currentEffects, ...newEffects],
        } as typeof item
      })
      return withItemIndexes(nextItems, state)
    }),

  // Update effect
  _updateEffect: (itemId, effectId, updates) =>
    set((state) => {
      const nextItems = state.items.map((item) => {
        if (item.id !== itemId) return item
        // Audio items don't support visual effects
        if (item.type === 'audio') return item

        const effects = item.effects || []
        return {
          ...item,
          effects: effects.map((e) =>
            e.id === effectId
              ? {
                  ...e,
                  ...(updates.effect && { effect: updates.effect }),
                  ...(updates.enabled !== undefined && { enabled: updates.enabled }),
                }
              : e,
          ),
        } as typeof item
      })
      return withItemIndexes(nextItems, state)
    }),

  // Remove effect
  _removeEffect: (itemId, effectId) =>
    set((state) => {
      const nextItems = state.items.map((item) => {
        if (item.id !== itemId) return item
        // Audio items don't support visual effects
        if (item.type === 'audio') return item

        const effects = item.effects || []
        return {
          ...item,
          effects: effects.filter((e) => e.id !== effectId),
        } as typeof item
      })
      return withItemIndexes(nextItems, state)
    }),

  // Toggle effect
  _toggleEffect: (itemId, effectId) =>
    set((state) => {
      const nextItems = state.items.map((item) => {
        if (item.id !== itemId) return item
        // Audio items don't support visual effects
        if (item.type === 'audio') return item

        const effects = item.effects || []
        return {
          ...item,
          effects: effects.map((e) => (e.id === effectId ? { ...e, enabled: !e.enabled } : e)),
        } as typeof item
      })
      return withItemIndexes(nextItems, state)
    }),
}))

let prevItemsRef = useItemsStore.getState().items
let prevItemsMediaDependencyIds = useItemsStore.getState().mediaDependencyIds
let prevItemsMediaDependencyKey = buildMediaDependencyKey(prevItemsMediaDependencyIds)
useItemsStore.subscribe((state) => {
  if (state.items === prevItemsRef) {
    return
  }
  prevItemsRef = state.items
  const nextMediaDependencyIds = buildItemsMediaDependencyIds(state.items)
  const nextMediaDependencyKey = buildMediaDependencyKey(nextMediaDependencyIds)
  if (nextMediaDependencyKey === prevItemsMediaDependencyKey) {
    return
  }
  prevItemsMediaDependencyIds = nextMediaDependencyIds
  prevItemsMediaDependencyKey = nextMediaDependencyKey
  useItemsStore.setState({
    mediaDependencyIds: prevItemsMediaDependencyIds,
    mediaDependencyVersion: state.mediaDependencyVersion + 1,
  })
})

function syncInOutPointsToTimelineBounds(items: TimelineItem[], fps: number) {
  const markersState = useMarkersStore.getState()
  const sanitizedInOutPoints = sanitizeInOutPoints({
    inPoint: markersState.inPoint,
    outPoint: markersState.outPoint,
    maxFrame: getEffectiveTimelineMaxFrame(items, fps),
  })

  if (
    sanitizedInOutPoints.inPoint === markersState.inPoint &&
    sanitizedInOutPoints.outPoint === markersState.outPoint
  ) {
    return
  }

  useMarkersStore.setState({
    inPoint: sanitizedInOutPoints.inPoint,
    outPoint: sanitizedInOutPoints.outPoint,
  })
}

let prevMaxItemEndFrame = useItemsStore.getState().maxItemEndFrame
useItemsStore.subscribe((state) => {
  if (state.maxItemEndFrame === prevMaxItemEndFrame) {
    return
  }

  prevMaxItemEndFrame = state.maxItemEndFrame
  syncInOutPointsToTimelineBounds(state.items, useTimelineSettingsStore.getState().fps)
})

useTimelineSettingsStore.subscribe((state, prevState) => {
  if (state.fps === prevState.fps) {
    return
  }

  syncInOutPointsToTimelineBounds(useItemsStore.getState().items, state.fps)
})
