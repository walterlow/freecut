import { audioBufferToWavBlob } from '@/features/editor/deps/composition-runtime'

interface AudiobookSfxMasteringCue {
  label: string
  mixVolumeDb: number
  role?: 'ambience' | 'foreground' | 'impact' | 'transition'
}

interface MasteringChainPreset {
  highPassFrequency: number
  lowShelfGain: number
  presenceFrequency: number
  presenceGain: number
  airGain: number
  compressorThreshold: number
  compressorRatio: number
  compressorAttack: number
  compressorRelease: number
  saturationDrive: number
}

export interface CinematicSweetenerProfile {
  lowImpactGain: number
  reverseAirGain: number
  widePreWhooshGain: number
  delayedImpactGain: number
  delayedImpactSeconds: number
  roomBloomGain: number
  motionAirGain: number
  sparkleGain: number
  transientSnapGain: number
  foleyTextureGain: number
  impactCrackGain: number
  cinematicTailGain: number
}

export interface AudiobookSfxMasteringInput {
  blob: Blob
  file: File
  cue: AudiobookSfxMasteringCue
  fallbackDuration: number
  signal?: AbortSignal
}

export interface AudiobookSfxMasteringResult {
  blob: Blob
  file: File
  duration: number
  mastered: boolean
}

export interface AudiobookSfxCandidateMetrics {
  peakDb: number
  rmsDb: number
  crestDb: number
  stereoSpread: number
  silenceRatio: number
  durationSeconds: number
  transientContrastDb?: number
  envelopeVariation?: number
  activityRatio?: number
}

export interface AudiobookSfxCandidateScore extends AudiobookSfxCandidateMetrics {
  score: number
  issues: string[]
}

export interface AudiobookSfxCandidateAnalysisInput {
  blob: Blob
  cue: AudiobookSfxMasteringCue
  fallbackDuration: number
  signal?: AbortSignal
}

interface AudiobookSfxCandidateIssueContext {
  cue: AudiobookSfxMasteringCue
  metrics: AudiobookSfxCandidateMetrics
  isAmbience: boolean
}

interface AudiobookSfxCandidateIssueRule {
  id: string
  matches: (context: AudiobookSfxCandidateIssueContext) => boolean
}

const MAX_NORMALIZE_GAIN_DB = 24
const MIN_DECIBELS = -96
const FOREGROUND_TARGET_PEAK_DB = -1.6
const IMPACT_TARGET_PEAK_DB = -1.4
const AMBIENCE_TARGET_PEAK_DB = -2.2
const FOREGROUND_TARGET_RMS_DB = -15.2
const IMPACT_TARGET_RMS_DB = -13.8
const AMBIENCE_TARGET_RMS_DB = -23
const AMBIENCE_VOLUME_THRESHOLD_DB = -6
const FOREGROUND_CHAIN_PRESET: MasteringChainPreset = {
  highPassFrequency: 38,
  lowShelfGain: 4.2,
  presenceFrequency: 2300,
  presenceGain: 3.2,
  airGain: 2.3,
  compressorThreshold: -25,
  compressorRatio: 3.6,
  compressorAttack: 0.004,
  compressorRelease: 0.18,
  saturationDrive: 1.28,
}
const AMBIENCE_CHAIN_PRESET: MasteringChainPreset = {
  highPassFrequency: 28,
  lowShelfGain: 3.2,
  presenceFrequency: 1800,
  presenceGain: 2.5,
  airGain: 1.9,
  compressorThreshold: -30,
  compressorRatio: 3,
  compressorAttack: 0.015,
  compressorRelease: 0.32,
  saturationDrive: 1.24,
}
const CANDIDATE_ISSUE_RULES: AudiobookSfxCandidateIssueRule[] = [
  {
    id: 'too-short',
    matches: ({ metrics }) => metrics.durationSeconds < 0.75,
  },
  {
    id: 'too-much-silence',
    matches: ({ metrics }) => metrics.silenceRatio > 0.42,
  },
  {
    id: 'weak-peak',
    matches: ({ metrics }) => metrics.peakDb < -24,
  },
  {
    id: 'thin-body',
    matches: ({ metrics, isAmbience }) => !isAmbience && metrics.rmsDb < -27,
  },
  {
    id: 'thin-impact-body',
    matches: ({ cue, metrics }) =>
      (cue.role === 'impact' || cue.role === 'transition') && metrics.rmsDb < -22.5,
  },
  {
    id: 'ambience-too-hot',
    matches: ({ metrics, isAmbience }) => isAmbience && metrics.rmsDb > -10,
  },
  {
    id: 'overlimited-source',
    matches: ({ metrics, isAmbience }) =>
      !isAmbience && metrics.peakDb > -0.15 && metrics.crestDb < 8.5,
  },
  {
    id: 'impact-too-hot',
    matches: ({ cue, metrics }) =>
      (cue.role === 'impact' || cue.role === 'transition') && metrics.rmsDb > -8.5,
  },
  {
    id: 'narrow-or-mono',
    matches: ({ metrics }) => metrics.stereoSpread < 0.03,
  },
  {
    id: 'low-transient-contrast',
    matches: ({ cue, metrics, isAmbience }) =>
      !isAmbience &&
      Number.isFinite(metrics.transientContrastDb) &&
      (metrics.transientContrastDb ?? 0) <
        (cue.role === 'impact' || cue.role === 'transition' ? 7.4 : 5.8),
  },
  {
    id: 'flat-envelope',
    matches: ({ cue, metrics, isAmbience }) =>
      !isAmbience &&
      Number.isFinite(metrics.envelopeVariation) &&
      (metrics.envelopeVariation ?? 0) <
        (cue.role === 'impact' || cue.role === 'transition' ? 0.36 : 0.28),
  },
  {
    id: 'too-continuous-for-impact',
    matches: ({ cue, metrics }) =>
      (cue.role === 'impact' || cue.role === 'transition') &&
      Number.isFinite(metrics.activityRatio) &&
      (metrics.activityRatio ?? 0) > 0.88 &&
      Number.isFinite(metrics.envelopeVariation) &&
      (metrics.envelopeVariation ?? 0) < 0.58,
  },
  {
    id: 'too-static',
    matches: ({ metrics, isAmbience }) =>
      isAmbience &&
      Number.isFinite(metrics.envelopeVariation) &&
      (metrics.envelopeVariation ?? 0) < 0.08 &&
      (metrics.activityRatio ?? 1) > 0.92,
  },
  {
    id: 'role-uncertain-thin',
    matches: ({ cue, metrics }) => !cue.role && cue.mixVolumeDb > 5 && metrics.rmsDb < -30,
  },
]

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Audiobook sound effect generation cancelled', 'AbortError')
  }
}

function dbToGain(db: number): number {
  return 10 ** (db / 20)
}

function amplitudeToDb(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return MIN_DECIBELS
  return Math.max(MIN_DECIBELS, 20 * Math.log10(value))
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function clampSample(value: number): number {
  return Math.max(-1, Math.min(1, value))
}

export function createMasteredSfxFileName(fileName: string): string {
  const extensionIndex = fileName.lastIndexOf('.')
  if (extensionIndex <= 0) return `${fileName || 'audiobook-sfx'}-cinematic-mastered.wav`

  return `${fileName.slice(0, extensionIndex)}-cinematic-mastered.wav`
}

export function getAudiobookSfxTargetPeakDb(
  cue: Pick<AudiobookSfxMasteringCue, 'mixVolumeDb'> &
    Partial<Pick<AudiobookSfxMasteringCue, 'role'>>,
) {
  if (cue.role === 'ambience') return AMBIENCE_TARGET_PEAK_DB
  if (cue.role === 'impact' || cue.role === 'transition') return IMPACT_TARGET_PEAK_DB

  return cue.mixVolumeDb <= AMBIENCE_VOLUME_THRESHOLD_DB
    ? AMBIENCE_TARGET_PEAK_DB
    : FOREGROUND_TARGET_PEAK_DB
}

export function calculatePeakNormalizeGain(peak: number, targetPeakDb: number): number {
  if (!Number.isFinite(peak) || peak <= 0) return 1
  return Math.min(dbToGain(MAX_NORMALIZE_GAIN_DB), dbToGain(targetPeakDb) / peak)
}

export function getAudiobookSfxTargetRmsDb(cue: AudiobookSfxMasteringCue): number {
  if (cue.role === 'ambience' || (!cue.role && cue.mixVolumeDb <= AMBIENCE_VOLUME_THRESHOLD_DB)) {
    return AMBIENCE_TARGET_RMS_DB
  }
  if (cue.role === 'impact' || cue.role === 'transition') return IMPACT_TARGET_RMS_DB
  return FOREGROUND_TARGET_RMS_DB
}

export function calculateRmsNormalizeGain(params: {
  rms: number
  peak: number
  targetRmsDb: number
  targetPeakDb: number
}): number {
  const { rms, peak, targetRmsDb, targetPeakDb } = params
  if (!Number.isFinite(rms) || rms <= 0) return 1

  const targetRmsGain = dbToGain(targetRmsDb) / rms
  const targetPeakGain = Number.isFinite(peak) && peak > 0 ? dbToGain(targetPeakDb) / peak : 1
  return Math.min(dbToGain(MAX_NORMALIZE_GAIN_DB), targetRmsGain, targetPeakGain * 1.8)
}

function getAudioContextCtor(): typeof AudioContext | null {
  return globalThis.AudioContext ?? null
}

function getOfflineAudioContextCtor(): typeof OfflineAudioContext | null {
  return globalThis.OfflineAudioContext ?? null
}

function getMasteringChainPreset(isAmbience: boolean): MasteringChainPreset {
  return isAmbience ? AMBIENCE_CHAIN_PRESET : FOREGROUND_CHAIN_PRESET
}

function isAmbienceCue(cue: AudiobookSfxMasteringCue): boolean {
  return cue.role === 'ambience' || (!cue.role && cue.mixVolumeDb <= AMBIENCE_VOLUME_THRESHOLD_DB)
}

function normalizeLabel(label: string): string {
  return label.toLowerCase().replace(/\s+/g, ' ').trim()
}

function isMechanicalSweetenerLabel(label: string): boolean {
  return ['clock', 'metal', 'magic'].some((term) => label.includes(term))
}

function isRevealSweetenerLabel(label: string): boolean {
  return ['reveal', 'chapter', 'decision', 'power', 'secrecy', 'story hit', 'scene turn'].some(
    (term) => label.includes(term),
  )
}

function getAmbienceSweetenerProfile(isMechanical: boolean): CinematicSweetenerProfile {
  return {
    lowImpactGain: 0,
    reverseAirGain: 0,
    widePreWhooshGain: 0,
    delayedImpactGain: 0,
    delayedImpactSeconds: 0,
    roomBloomGain: 0.035,
    motionAirGain: 0.022,
    sparkleGain: isMechanical ? 0.012 : 0,
    transientSnapGain: 0,
    foleyTextureGain: 0,
    impactCrackGain: 0,
    cinematicTailGain: 0.1,
  }
}

function getRevealSweetenerProfile(isMechanical: boolean): CinematicSweetenerProfile {
  return {
    lowImpactGain: 0.54,
    reverseAirGain: 0.18,
    widePreWhooshGain: 0.16,
    delayedImpactGain: 0.36,
    delayedImpactSeconds: 0.31,
    roomBloomGain: 0.3,
    motionAirGain: 0.18,
    sparkleGain: isMechanical ? 0.08 : 0.028,
    transientSnapGain: 0.16,
    foleyTextureGain: 0.22,
    impactCrackGain: 0.2,
    cinematicTailGain: 0.74,
  }
}

function getDefaultSweetenerProfile(
  label: string,
  isMechanical: boolean,
): CinematicSweetenerProfile {
  const isSmallFoley = label.includes('folder') || label.includes('phone')
  return {
    lowImpactGain: 0.24,
    reverseAirGain: 0.052,
    widePreWhooshGain: 0.035,
    delayedImpactGain: 0.08,
    delayedImpactSeconds: 0,
    roomBloomGain: 0.16,
    motionAirGain: 0.08,
    sparkleGain: isMechanical ? 0.072 : isSmallFoley ? 0.034 : 0,
    transientSnapGain: 0.06,
    foleyTextureGain: isSmallFoley ? 0.12 : 0.07,
    impactCrackGain: 0.036,
    cinematicTailGain: 0.38,
  }
}

export function getCinematicSweetenerProfile(
  cue: Pick<AudiobookSfxMasteringCue, 'label' | 'mixVolumeDb'> &
    Partial<Pick<AudiobookSfxMasteringCue, 'role'>>,
): CinematicSweetenerProfile {
  const label = normalizeLabel(cue.label)
  const isMechanical = isMechanicalSweetenerLabel(label)
  if (cue.role === 'ambience' || cue.mixVolumeDb <= AMBIENCE_VOLUME_THRESHOLD_DB) {
    return getAmbienceSweetenerProfile(isMechanical)
  }
  if (cue.role === 'impact' || cue.role === 'transition' || isRevealSweetenerLabel(label)) {
    return getRevealSweetenerProfile(isMechanical)
  }
  return getDefaultSweetenerProfile(label, isMechanical)
}

async function decodeAudioBlob(blob: Blob, signal?: AbortSignal): Promise<AudioBuffer | null> {
  const AudioContextCtor = getAudioContextCtor()
  if (!AudioContextCtor) return null

  const context = new AudioContextCtor()
  try {
    assertNotAborted(signal)
    const source = await blob.arrayBuffer()
    assertNotAborted(signal)
    return await context.decodeAudioData(source.slice(0))
  } finally {
    await context.close().catch(() => undefined)
  }
}

function connectMasteringChain(params: {
  context: OfflineAudioContext
  source: AudioBufferSourceNode
  preset: MasteringChainPreset
}): void {
  const { context, source, preset } = params
  const highPass = context.createBiquadFilter()
  highPass.type = 'highpass'
  highPass.frequency.value = preset.highPassFrequency
  highPass.Q.value = 0.65

  const lowShelf = context.createBiquadFilter()
  lowShelf.type = 'lowshelf'
  lowShelf.frequency.value = 95
  lowShelf.gain.value = preset.lowShelfGain

  const presence = context.createBiquadFilter()
  presence.type = 'peaking'
  presence.frequency.value = preset.presenceFrequency
  presence.Q.value = 0.9
  presence.gain.value = preset.presenceGain

  const air = context.createBiquadFilter()
  air.type = 'highshelf'
  air.frequency.value = 7200
  air.gain.value = preset.airGain

  const compressor = context.createDynamicsCompressor()
  compressor.threshold.value = preset.compressorThreshold
  compressor.knee.value = 18
  compressor.ratio.value = preset.compressorRatio
  compressor.attack.value = preset.compressorAttack
  compressor.release.value = preset.compressorRelease

  const saturation = context.createWaveShaper()
  saturation.curve = createSaturationCurve(preset.saturationDrive)
  saturation.oversample = '4x'

  source.connect(highPass)
  highPass.connect(lowShelf)
  lowShelf.connect(presence)
  presence.connect(air)
  air.connect(compressor)
  compressor.connect(saturation)
  saturation.connect(context.destination)
}

function createSaturationCurve(drive: number): Float32Array<ArrayBuffer> {
  const sampleCount = 1024
  const curve = new Float32Array(sampleCount) as Float32Array<ArrayBuffer>
  const amount = Math.max(0, drive - 1) * 3
  for (let index = 0; index < sampleCount; index += 1) {
    const x = (index * 2) / (sampleCount - 1) - 1
    curve[index] = ((1 + amount) * x) / (1 + amount * Math.abs(x))
  }
  return curve
}

function measurePeak(buffer: AudioBuffer): number {
  let peak = 0
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel)
    for (let index = 0; index < data.length; index += 1) {
      peak = Math.max(peak, Math.abs(data[index] ?? 0))
    }
  }
  return peak
}

function measureRms(buffer: AudioBuffer): number {
  let sum = 0
  let count = 0
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel)
    for (let index = 0; index < data.length; index += 1) {
      const sample = data[index] ?? 0
      sum += sample * sample
      count += 1
    }
  }
  return count > 0 ? Math.sqrt(sum / count) : 0
}

function measureStereoSpread(buffer: AudioBuffer): number {
  if (buffer.numberOfChannels < 2 || buffer.length === 0) return 0

  const left = buffer.getChannelData(0)
  const right = buffer.getChannelData(1)
  const stride = Math.max(1, Math.floor(buffer.length / 120000))
  let side = 0
  let total = 0

  for (let index = 0; index < buffer.length; index += stride) {
    const leftSample = left[index] ?? 0
    const rightSample = right[index] ?? 0
    side += Math.abs(leftSample - rightSample)
    total += Math.abs(leftSample) + Math.abs(rightSample)
  }

  return total > 0 ? clamp(side / total, 0, 1) : 0
}

function measureSilenceRatio(buffer: AudioBuffer, threshold: number): number {
  if (buffer.length === 0) return 1

  const stride = Math.max(1, Math.floor(buffer.length / 120000))
  let quietFrameCount = 0
  let frameCount = 0

  for (let index = 0; index < buffer.length; index += stride) {
    let frameEnergy = 0
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      frameEnergy += Math.abs(buffer.getChannelData(channel)[index] ?? 0)
    }
    frameEnergy /= Math.max(1, buffer.numberOfChannels)
    if (frameEnergy < threshold) quietFrameCount += 1
    frameCount += 1
  }

  return frameCount > 0 ? quietFrameCount / frameCount : 1
}

function measureEnvelopeStats(
  buffer: AudioBuffer,
): Pick<
  AudiobookSfxCandidateMetrics,
  'transientContrastDb' | 'envelopeVariation' | 'activityRatio'
> {
  if (buffer.length === 0) {
    return { transientContrastDb: 0, envelopeVariation: 0, activityRatio: 0 }
  }

  const windowSize = Math.max(128, Math.round(buffer.sampleRate * 0.02))
  const frameLevels: number[] = []

  for (let start = 0; start < buffer.length; start += windowSize) {
    const end = Math.min(buffer.length, start + windowSize)
    let sum = 0
    let count = 0

    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const data = buffer.getChannelData(channel)
      for (let index = start; index < end; index += 1) {
        const sample = data[index] ?? 0
        sum += sample * sample
        count += 1
      }
    }

    frameLevels.push(count > 0 ? Math.sqrt(sum / count) : 0)
  }

  const activeFrames = frameLevels.filter((level) => level > 0.0007)
  if (activeFrames.length === 0) {
    return { transientContrastDb: 0, envelopeVariation: 0, activityRatio: 0 }
  }

  const sorted = [...activeFrames].sort((left, right) => left - right)
  const percentile = (ratio: number) =>
    sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * ratio)))] ?? 0
  const mean = activeFrames.reduce((sum, level) => sum + level, 0) / activeFrames.length
  const variance =
    activeFrames.reduce((sum, level) => sum + (level - mean) ** 2, 0) / activeFrames.length

  return {
    transientContrastDb: Math.max(
      0,
      amplitudeToDb(percentile(0.95)) - amplitudeToDb(percentile(0.35)),
    ),
    envelopeVariation: clamp(Math.sqrt(variance) / Math.max(mean, 1e-6), 0, 4),
    activityRatio: activeFrames.length / Math.max(1, frameLevels.length),
  }
}

function scoreWindow(params: {
  value: number
  min: number
  idealMin: number
  idealMax: number
  max: number
  weight: number
}): number {
  const { value, min, idealMin, idealMax, max, weight } = params
  if (value < min || value > max) return 0
  if (value >= idealMin && value <= idealMax) return weight
  if (value < idealMin) {
    return weight * clamp((value - min) / Math.max(0.001, idealMin - min), 0, 1)
  }
  return weight * clamp((max - value) / Math.max(0.001, max - idealMax), 0, 1)
}

function scoreWindows(windows: Parameters<typeof scoreWindow>[0][]): number {
  return windows.reduce((total, window) => total + scoreWindow(window), 0)
}

function createFallbackCandidateScore(
  cue: AudiobookSfxMasteringCue,
  fallbackDuration: number,
): AudiobookSfxCandidateScore {
  const isAmbience = isAmbienceCue(cue)
  return {
    peakDb: isAmbience ? -16 : -12,
    rmsDb: isAmbience ? -28 : -22,
    crestDb: 10,
    stereoSpread: isAmbience ? 0.16 : 0.08,
    silenceRatio: 0.08,
    durationSeconds: fallbackDuration,
    transientContrastDb: isAmbience ? 2 : 8,
    envelopeVariation: isAmbience ? 0.18 : 0.48,
    activityRatio: isAmbience ? 0.82 : 0.44,
    score: 6,
    issues: ['analysis-unavailable'],
  }
}

function getAudiobookSfxCandidateIssues(params: {
  cue: AudiobookSfxMasteringCue
  metrics: AudiobookSfxCandidateMetrics
  isAmbience: boolean
}): string[] {
  return CANDIDATE_ISSUE_RULES.filter((rule) => rule.matches(params)).map((rule) => rule.id)
}

function scoreAmbienceCandidate(metrics: AudiobookSfxCandidateMetrics): number {
  const envelopeVariation = metrics.envelopeVariation ?? 0.18
  const activityRatio = metrics.activityRatio ?? 0.75

  return (
    scoreWindow({
      value: metrics.rmsDb,
      min: -40,
      idealMin: -30,
      idealMax: -17,
      max: -10,
      weight: 2.4,
    }) +
    scoreWindow({
      value: metrics.peakDb,
      min: -28,
      idealMin: -18,
      idealMax: -4,
      max: -1,
      weight: 1.6,
    }) +
    clamp(metrics.stereoSpread / 0.2, 0, 1) * 2 +
    (1 - clamp(metrics.silenceRatio / 0.42, 0, 1)) * 2 +
    scoreWindow({
      value: metrics.crestDb,
      min: 2,
      idealMin: 5,
      idealMax: 18,
      max: 28,
      weight: 1,
    }) +
    scoreWindow({
      value: envelopeVariation,
      min: 0.03,
      idealMin: 0.12,
      idealMax: 0.75,
      max: 2.4,
      weight: 0.7,
    }) +
    scoreWindow({
      value: activityRatio,
      min: 0.18,
      idealMin: 0.38,
      idealMax: 0.95,
      max: 1,
      weight: 0.5,
    })
  )
}

function scoreForegroundCandidate(
  metrics: AudiobookSfxCandidateMetrics,
  isPunctuation: boolean,
): number {
  const transientContrastDb = metrics.transientContrastDb ?? (isPunctuation ? 9 : 6)
  const envelopeVariation = metrics.envelopeVariation ?? (isPunctuation ? 0.52 : 0.34)
  const activityRatio = metrics.activityRatio ?? (isPunctuation ? 0.38 : 0.52)
  const profile = isPunctuation
    ? {
        rmsIdealMin: -22,
        rmsIdealMax: -10,
        crestIdealMin: 5,
        crestIdealMax: 20,
        transientIdealMin: 8,
        transientIdealMax: 18,
        envelopeIdealMin: 0.42,
        envelopeIdealMax: 1.7,
        activityMin: 0.03,
        activityIdealMin: 0.1,
        activityIdealMax: 0.72,
      }
    : {
        rmsIdealMin: -26,
        rmsIdealMax: -12,
        crestIdealMin: 4,
        crestIdealMax: 17,
        transientIdealMin: 4.8,
        transientIdealMax: 15,
        envelopeIdealMin: 0.24,
        envelopeIdealMax: 1.5,
        activityMin: 0.08,
        activityIdealMin: 0.18,
        activityIdealMax: 0.92,
      }

  return (
    scoreWindows([
      {
        value: metrics.rmsDb,
        min: -38,
        idealMin: profile.rmsIdealMin,
        idealMax: profile.rmsIdealMax,
        max: -5,
        weight: 2.5,
      },
      {
        value: metrics.peakDb,
        min: -26,
        idealMin: -12,
        idealMax: -1.5,
        max: -0.1,
        weight: 1.8,
      },
      {
        value: metrics.crestDb,
        min: 2,
        idealMin: profile.crestIdealMin,
        idealMax: profile.crestIdealMax,
        max: 32,
        weight: 1.3,
      },
      {
        value: transientContrastDb,
        min: 2,
        idealMin: profile.transientIdealMin,
        idealMax: profile.transientIdealMax,
        max: 34,
        weight: 1.1,
      },
      {
        value: envelopeVariation,
        min: 0.08,
        idealMin: profile.envelopeIdealMin,
        idealMax: profile.envelopeIdealMax,
        max: 3.2,
        weight: 0.8,
      },
      {
        value: activityRatio,
        min: profile.activityMin,
        idealMin: profile.activityIdealMin,
        idealMax: profile.activityIdealMax,
        max: 1,
        weight: 0.4,
      },
    ]) +
    clamp(metrics.stereoSpread / 0.14, 0, 1) * 1.2 +
    (1 - clamp(metrics.silenceRatio / 0.38, 0, 1)) * 2.2
  )
}

function getDurationQualityAdjustment(metrics: AudiobookSfxCandidateMetrics): number {
  let adjustment = metrics.durationSeconds >= 1.5 ? 0.8 : 0
  if (metrics.durationSeconds < 0.75) adjustment -= 1.6
  if (metrics.silenceRatio > 0.65) adjustment -= 2
  return adjustment
}

function getIssueQualityPenalty(issues: string[]): number {
  return issues.reduce((penalty, issueId) => {
    switch (issueId) {
      case 'low-transient-contrast':
        return penalty + 1.25
      case 'flat-envelope':
        return penalty + 1.15
      case 'too-continuous-for-impact':
        return penalty + 1.05
      case 'too-static':
        return penalty + 0.9
      case 'overlimited-source':
        return penalty + 1.15
      case 'impact-too-hot':
        return penalty + 0.85
      case 'narrow-or-mono':
        return penalty + 0.55
      default:
        return penalty
    }
  }, 0)
}

export function scoreAudiobookSfxCandidateMetrics(
  cue: AudiobookSfxMasteringCue,
  metrics: AudiobookSfxCandidateMetrics,
): AudiobookSfxCandidateScore {
  const isAmbience = isAmbienceCue(cue)
  const isPunctuation = cue.role === 'impact' || cue.role === 'transition'
  const roleScore = isAmbience
    ? scoreAmbienceCandidate(metrics)
    : scoreForegroundCandidate(metrics, isPunctuation)
  const issues = getAudiobookSfxCandidateIssues({ cue, metrics, isAmbience })
  const score =
    1 + roleScore + getDurationQualityAdjustment(metrics) - getIssueQualityPenalty(issues)

  return {
    ...metrics,
    score: Math.round(clamp(score, 0, 10) * 10) / 10,
    issues,
  }
}

export async function analyzeAudiobookSfxCandidate({
  blob,
  cue,
  fallbackDuration,
  signal,
}: AudiobookSfxCandidateAnalysisInput): Promise<AudiobookSfxCandidateScore> {
  try {
    const decoded = await decodeAudioBlob(blob, signal)
    if (!decoded) return createFallbackCandidateScore(cue, fallbackDuration)

    const peak = measurePeak(decoded)
    const rms = measureRms(decoded)
    const peakDb = amplitudeToDb(peak)
    const rmsDb = amplitudeToDb(rms)
    const metrics: AudiobookSfxCandidateMetrics = {
      peakDb,
      rmsDb,
      crestDb: Math.max(0, peakDb - rmsDb),
      stereoSpread: measureStereoSpread(decoded),
      silenceRatio: measureSilenceRatio(decoded, isAmbienceCue(cue) ? 0.0018 : 0.0028),
      durationSeconds: decoded.duration || fallbackDuration,
      ...measureEnvelopeStats(decoded),
    }

    return scoreAudiobookSfxCandidateMetrics(cue, metrics)
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    return createFallbackCandidateScore(cue, fallbackDuration)
  }
}

function applyFades(buffer: AudioBuffer): void {
  const fadeInFrames = Math.min(buffer.length, Math.round(buffer.sampleRate * 0.005))
  const fadeOutFrames = Math.min(buffer.length, Math.round(buffer.sampleRate * 0.12))

  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel)
    for (let index = 0; index < fadeInFrames; index += 1) {
      const gain = index / Math.max(1, fadeInFrames)
      data[index] = (data[index] ?? 0) * gain
    }
    for (let index = 0; index < fadeOutFrames; index += 1) {
      const sampleIndex = data.length - index - 1
      const gain = index / Math.max(1, fadeOutFrames)
      data[sampleIndex] = (data[sampleIndex] ?? 0) * gain
    }
  }
}

function applyStereoWidth(buffer: AudioBuffer, isAmbience: boolean): void {
  if (buffer.numberOfChannels < 2) return

  const left = buffer.getChannelData(0)
  const right = buffer.getChannelData(1)
  const sideAmount = isAmbience ? 1.22 : 1.1
  const delaySamples = Math.round(buffer.sampleRate * 0.007)
  const leftCopy = new Float32Array(left)

  for (let index = 0; index < buffer.length; index += 1) {
    const delayedLeft = leftCopy[Math.max(0, index - delaySamples)] ?? 0
    const seededRight =
      right[index] === left[index] ? right[index]! * 0.94 + delayedLeft * 0.06 : right[index]!
    const mid = ((left[index] ?? 0) + seededRight) * 0.5
    const side = ((left[index] ?? 0) - seededRight) * 0.5 * sideAmount
    left[index] = clampSample(mid + side)
    right[index] = clampSample(mid - side)
  }
}

function seededNoise(index: number, seed: number): number {
  const value = Math.sin(index * 12.9898 + seed * 78.233) * 43758.5453
  return (value - Math.floor(value)) * 2 - 1
}

function addLowImpact(buffer: AudioBuffer, gain: number): void {
  if (gain <= 0) return

  const sampleRate = buffer.sampleRate
  const frameCount = Math.min(buffer.length, Math.round(sampleRate * 1.25))
  let phase = 0

  for (let index = 0; index < frameCount; index += 1) {
    const time = index / sampleRate
    const progress = index / Math.max(1, frameCount - 1)
    const frequency = 98 - progress * 54
    phase += (Math.PI * 2 * frequency) / sampleRate
    const envelope = Math.exp(-4.4 * time) * Math.min(1, time / 0.022)
    const harmonic = Math.sin(phase * 2.02) * 0.24
    const sample = (Math.sin(phase) + harmonic) * envelope * gain

    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const data = buffer.getChannelData(channel)
      data[index] = clampSample((data[index] ?? 0) + sample)
    }
  }
}

function addTransientSnap(buffer: AudioBuffer, gain: number, seed: number): void {
  if (gain <= 0) return

  const sampleRate = buffer.sampleRate
  const frameCount = Math.min(buffer.length, Math.round(sampleRate * 0.24))
  let previousNoise = 0

  for (let index = 0; index < frameCount; index += 1) {
    const time = index / sampleRate
    const envelope = Math.exp(-24 * time) * Math.min(1, time / 0.005)
    const rawNoise = seededNoise(index, seed)
    const snapNoise = rawNoise - previousNoise * 0.84
    previousNoise = rawNoise
    const clickBody = Math.sin(Math.PI * 2 * 185 * time) * Math.exp(-15 * time)
    const sample = (snapNoise * 0.78 + clickBody * 0.68) * envelope * gain

    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const data = buffer.getChannelData(channel)
      const stereoTilt = channel === 0 ? 1 : 0.86
      data[index] = clampSample((data[index] ?? 0) + sample * stereoTilt)
    }
  }
}

function addReverseAir(buffer: AudioBuffer, gain: number, seed: number): void {
  if (gain <= 0) return

  const sampleRate = buffer.sampleRate
  const frameCount = Math.min(buffer.length, Math.round(sampleRate * 0.42))
  let previousNoise = 0

  for (let index = 0; index < frameCount; index += 1) {
    const progress = index / Math.max(1, frameCount - 1)
    const envelope = progress ** 1.7
    const rawNoise = seededNoise(index, seed)
    const filteredNoise = rawNoise - previousNoise * 0.68
    previousNoise = rawNoise

    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const data = buffer.getChannelData(channel)
      const stereoTilt = channel === 0 ? 0.92 : -1
      data[index] = clampSample((data[index] ?? 0) + filteredNoise * envelope * gain * stereoTilt)
    }
  }
}

function addWidePreWhoosh(buffer: AudioBuffer, gain: number, seed: number): void {
  if (gain <= 0) return

  const sampleRate = buffer.sampleRate
  const frameCount = Math.min(buffer.length, Math.round(sampleRate * 0.82))
  let previousNoise = 0

  for (let index = 0; index < frameCount; index += 1) {
    const progress = index / Math.max(1, frameCount - 1)
    const envelope = Math.sin(progress * Math.PI * 0.5) ** 2.1
    const rawNoise = seededNoise(index, seed)
    const airyNoise = rawNoise - previousNoise * 0.74
    previousNoise = rawNoise
    const lowMotion = Math.sin(Math.PI * 2 * (52 + progress * 18) * (index / sampleRate)) * 0.22
    const sample = (airyNoise * 0.74 + lowMotion) * envelope * gain

    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const data = buffer.getChannelData(channel)
      const stereoTilt = channel === 0 ? -0.95 : 1
      data[index] = clampSample((data[index] ?? 0) + sample * stereoTilt)
    }
  }
}

function addDelayedImpactBody(
  buffer: AudioBuffer,
  gain: number,
  delaySeconds: number,
  seed: number,
): void {
  if (gain <= 0 || delaySeconds <= 0) return

  const sampleRate = buffer.sampleRate
  const startFrame = Math.min(buffer.length, Math.max(0, Math.round(sampleRate * delaySeconds)))
  const frameCount = Math.min(buffer.length - startFrame, Math.round(sampleRate * 1.35))
  let phase = 0
  let previousNoise = 0

  for (let offset = 0; offset < frameCount; offset += 1) {
    const index = startFrame + offset
    const time = offset / sampleRate
    const progress = offset / Math.max(1, frameCount - 1)
    const frequency = 86 - progress * 48
    phase += (Math.PI * 2 * frequency) / sampleRate
    const bodyEnvelope = Math.exp(-3.8 * time) * Math.min(1, time / 0.018)
    const snapEnvelope = Math.exp(-32 * time) * Math.min(1, time / 0.004)
    const rawNoise = seededNoise(index, seed)
    const snapNoise = rawNoise - previousNoise * 0.78
    previousNoise = rawNoise
    const sub = (Math.sin(phase) + Math.sin(phase * 2.04) * 0.18) * bodyEnvelope
    const snap = snapNoise * snapEnvelope * 0.46
    const sample = (sub + snap) * gain

    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const data = buffer.getChannelData(channel)
      const stereoTilt = channel === 0 ? 1 : 0.9
      data[index] = clampSample((data[index] ?? 0) + sample * stereoTilt)
    }
  }
}

function addImpactCrack(buffer: AudioBuffer, gain: number, seed: number): void {
  if (gain <= 0) return

  const sampleRate = buffer.sampleRate
  const frameCount = Math.min(buffer.length, Math.round(sampleRate * 0.36))
  let previousNoise = 0

  for (let index = 0; index < frameCount; index += 1) {
    const time = index / sampleRate
    const rawNoise = seededNoise(index, seed)
    const crackNoise = rawNoise - previousNoise * 0.9
    previousNoise = rawNoise
    const woodBody = Math.sin(Math.PI * 2 * 172 * time) * Math.exp(-18 * time)
    const metalEdge = Math.sin(Math.PI * 2 * 1240 * time) * Math.exp(-42 * time)
    const envelope = Math.exp(-28 * time) * Math.min(1, time / 0.003)
    const sample = (crackNoise * 0.72 + woodBody * 0.52 + metalEdge * 0.18) * envelope * gain

    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const data = buffer.getChannelData(channel)
      const stereoTilt = channel === 0 ? 1 : 0.78
      data[index] = clampSample((data[index] ?? 0) + sample * stereoTilt)
    }
  }
}

function addFoleyTexture(buffer: AudioBuffer, gain: number, seed: number): void {
  if (gain <= 0) return

  const sampleRate = buffer.sampleRate
  const frameCount = Math.min(buffer.length, Math.round(sampleRate * 1.25))
  let previousNoise = 0

  for (let index = 0; index < frameCount; index += 1) {
    const time = index / sampleRate
    const progress = index / Math.max(1, frameCount - 1)
    const rawNoise = seededNoise(index, seed)
    const texturedNoise = rawNoise - previousNoise * 0.58
    previousNoise = rawNoise
    const envelope =
      Math.sin(Math.min(1, progress) * Math.PI) *
      (0.42 + 0.58 * Math.abs(Math.sin(Math.PI * 2 * 7.3 * time + seed)))
    const sample = texturedNoise * envelope * gain

    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const data = buffer.getChannelData(channel)
      const stereoTilt = channel === 0 ? 0.86 : -0.72
      data[index] = clampSample((data[index] ?? 0) + sample * stereoTilt)
    }
  }
}

function addRoomBloom(buffer: AudioBuffer, gain: number, seed: number): void {
  if (gain <= 0) return

  const sampleRate = buffer.sampleRate
  const frameCount = Math.min(buffer.length, Math.round(sampleRate * 2.5))
  let phaseA = seed * 0.013
  let phaseB = seed * 0.021
  let pressure = 0

  for (let index = 0; index < frameCount; index += 1) {
    const time = index / sampleRate
    const envelope = Math.exp(-1.18 * time) * Math.min(1, time / 0.055)
    const progress = index / Math.max(1, frameCount - 1)
    phaseA += (Math.PI * 2 * (54 - progress * 8)) / sampleRate
    phaseB += (Math.PI * 2 * (92 - progress * 13)) / sampleRate
    pressure += (seededNoise(index, seed + 71) - pressure) * 0.0028
    const bloom =
      (Math.sin(phaseA) * 0.52 + Math.sin(phaseB) * 0.24 + pressure * 6.2) * envelope * gain

    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const data = buffer.getChannelData(channel)
      const stereoTilt = channel === 0 ? 1 : 0.88
      data[index] = clampSample((data[index] ?? 0) + bloom * stereoTilt)
    }
  }
}

function addMotionAir(buffer: AudioBuffer, gain: number, seed: number): void {
  if (gain <= 0) return

  const sampleRate = buffer.sampleRate
  const frameCount = Math.min(buffer.length, Math.round(sampleRate * 1.7))
  let previousNoise = 0

  for (let index = 0; index < frameCount; index += 1) {
    const progress = index / Math.max(1, frameCount - 1)
    const attack = Math.min(1, progress / 0.18)
    const release = 1 - Math.max(0, progress - 0.48) / 0.52
    const envelope = Math.max(0, Math.min(attack, release)) ** 1.25
    const rawNoise = seededNoise(index, seed)
    const brightNoise = rawNoise - previousNoise * 0.72
    previousNoise = rawNoise

    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const data = buffer.getChannelData(channel)
      const stereoOffset = channel === 0 ? 1 : -0.9
      data[index] = clampSample((data[index] ?? 0) + brightNoise * envelope * gain * stereoOffset)
    }
  }
}

function addSparkle(buffer: AudioBuffer, gain: number, seed: number): void {
  if (gain <= 0) return

  const sampleRate = buffer.sampleRate
  const frequencies = [1180, 1760, 2430]
  const frameCount = Math.min(buffer.length, Math.round(sampleRate * 1.1))

  for (const [toneIndex, frequency] of frequencies.entries()) {
    const startFrame = Math.round(sampleRate * (0.08 + toneIndex * 0.07))
    for (let index = startFrame; index < frameCount; index += 1) {
      const time = (index - startFrame) / sampleRate
      const envelope = Math.exp(-4.8 * time)
      const mod = 1 + seededNoise(index, seed + toneIndex) * 0.012
      const sample = Math.sin(Math.PI * 2 * frequency * mod * time) * envelope * gain

      for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
        const data = buffer.getChannelData(channel)
        const stereoTilt = channel === 0 ? 1 : 0.82
        data[index] = clampSample((data[index] ?? 0) + sample * stereoTilt)
      }
    }
  }
}

function addCinematicTailTap(params: {
  data: Float32Array
  dry: Float32Array
  sampleRate: number
  delaySeconds: number
  tapGain: number
  profileGain: number
  stereoTilt: number
}): void {
  const delaySamples = Math.round(params.sampleRate * params.delaySeconds)
  if (delaySamples <= 0 || delaySamples >= params.data.length) return

  for (let index = delaySamples; index < params.data.length; index += 1) {
    const time = (index - delaySamples) / params.sampleRate
    const envelope = Math.exp(-2.9 * time)
    params.data[index] = clampSample(
      (params.data[index] ?? 0) +
        (params.dry[index - delaySamples] ?? 0) *
          params.tapGain *
          params.profileGain *
          envelope *
          params.stereoTilt,
    )
  }
}

function addCinematicTail(buffer: AudioBuffer, gain: number): void {
  if (gain <= 0) return

  const delays = [
    { seconds: 0.043, gain: 0.42 },
    { seconds: 0.091, gain: 0.28 },
    { seconds: 0.167, gain: 0.18 },
    { seconds: 0.281, gain: 0.1 },
  ]

  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel)
    const dry = new Float32Array(data)
    const stereoTilt = channel === 0 ? 1 : 0.92

    for (const tap of delays) {
      addCinematicTailTap({
        data,
        dry,
        sampleRate: buffer.sampleRate,
        delaySeconds: tap.seconds,
        tapGain: tap.gain,
        profileGain: gain,
        stereoTilt,
      })
    }
  }
}

function applyCinematicSweetener(buffer: AudioBuffer, cue: AudiobookSfxMasteringCue): void {
  const profile = getCinematicSweetenerProfile(cue)
  const seed = cue.label.length + Math.round(cue.mixVolumeDb * 10)
  addLowImpact(buffer, profile.lowImpactGain)
  addReverseAir(buffer, profile.reverseAirGain, seed + 31)
  addWidePreWhoosh(buffer, profile.widePreWhooshGain, seed + 37)
  addDelayedImpactBody(buffer, profile.delayedImpactGain, profile.delayedImpactSeconds, seed + 43)
  addImpactCrack(buffer, profile.impactCrackGain, seed + 47)
  addRoomBloom(buffer, profile.roomBloomGain, seed + 53)
  addTransientSnap(buffer, profile.transientSnapGain, seed + 5)
  addFoleyTexture(buffer, profile.foleyTextureGain, seed + 59)
  addMotionAir(buffer, profile.motionAirGain, seed)
  addSparkle(buffer, profile.sparkleGain, seed + 17)
  addCinematicTail(buffer, profile.cinematicTailGain)
}

function normalizePeak(buffer: AudioBuffer, targetPeakDb: number): void {
  const gain = calculatePeakNormalizeGain(measurePeak(buffer), targetPeakDb)
  if (gain === 1) return

  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel)
    for (let index = 0; index < data.length; index += 1) {
      data[index] = clampSample((data[index] ?? 0) * gain)
    }
  }
}

function applyGain(buffer: AudioBuffer, gain: number): void {
  if (!Number.isFinite(gain) || gain <= 0 || gain === 1) return

  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel)
    for (let index = 0; index < data.length; index += 1) {
      data[index] = clampSample((data[index] ?? 0) * gain)
    }
  }
}

function normalizeRmsBody(buffer: AudioBuffer, cue: AudiobookSfxMasteringCue): void {
  const gain = calculateRmsNormalizeGain({
    rms: measureRms(buffer),
    peak: measurePeak(buffer),
    targetRmsDb: getAudiobookSfxTargetRmsDb(cue),
    targetPeakDb: getAudiobookSfxTargetPeakDb(cue),
  })
  applyGain(buffer, gain)
}

function applySoftLimiter(buffer: AudioBuffer, cue: AudiobookSfxMasteringCue): void {
  const drive = isAmbienceCue(cue)
    ? 1.16
    : cue.role === 'impact' || cue.role === 'transition'
      ? 1.26
      : 1.22
  const normalizer = Math.tanh(drive)

  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel)
    for (let index = 0; index < data.length; index += 1) {
      data[index] = clampSample(Math.tanh((data[index] ?? 0) * drive) / normalizer)
    }
  }
}

async function renderMasteredAudio(
  sourceBuffer: AudioBuffer,
  cue: AudiobookSfxMasteringCue,
  signal?: AbortSignal,
): Promise<AudioBuffer | null> {
  const OfflineAudioContextCtor = getOfflineAudioContextCtor()
  if (!OfflineAudioContextCtor || sourceBuffer.length === 0) return null

  const isAmbience = isAmbienceCue(cue)
  const context = new OfflineAudioContextCtor(
    Math.min(2, Math.max(1, sourceBuffer.numberOfChannels || 1)),
    sourceBuffer.length,
    sourceBuffer.sampleRate,
  )
  const source = context.createBufferSource()
  source.buffer = sourceBuffer
  connectMasteringChain({ context, source, preset: getMasteringChainPreset(isAmbience) })

  assertNotAborted(signal)
  source.start(0)
  const rendered = await context.startRendering()
  assertNotAborted(signal)

  applyStereoWidth(rendered, isAmbience)
  applyCinematicSweetener(rendered, cue)
  normalizeRmsBody(rendered, cue)
  applySoftLimiter(rendered, cue)
  applyFades(rendered)
  normalizePeak(rendered, getAudiobookSfxTargetPeakDb(cue))
  return rendered
}

export async function masterAudiobookSfxFile({
  blob,
  file,
  cue,
  fallbackDuration,
  signal,
}: AudiobookSfxMasteringInput): Promise<AudiobookSfxMasteringResult> {
  try {
    const decoded = await decodeAudioBlob(blob, signal)
    if (!decoded) return { blob, file, duration: fallbackDuration, mastered: false }

    const masteredBuffer = await renderMasteredAudio(decoded, cue, signal)
    if (!masteredBuffer) {
      return {
        blob,
        file,
        duration: decoded.duration || fallbackDuration,
        mastered: false,
      }
    }

    const masteredBlob = audioBufferToWavBlob(masteredBuffer)
    const masteredFile = new File([masteredBlob], createMasteredSfxFileName(file.name), {
      type: 'audio/wav',
      lastModified: Date.now(),
    })

    return {
      blob: masteredBlob,
      file: masteredFile,
      duration: masteredBuffer.duration || decoded.duration || fallbackDuration,
      mastered: true,
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    return { blob, file, duration: fallbackDuration, mastered: false }
  }
}
