import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  CheckCircle2,
  ChevronDown,
  ClipboardCopy,
  Download,
  ExternalLink,
  FileDown,
  Info,
  ListPlus,
  Loader2,
  Pause,
  Play,
  Trash2,
  Volume2,
  WandSparkles,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { getMusicgenModelDefinition } from '@/shared/utils/musicgen-models'
import { useMediaPlaybackControls } from '@/shared/media/use-media-playback-controls'
import {
  getStoredTtsEngine,
  setStoredTtsEngine,
  type StoredTtsEngine,
} from '@/shared/utils/tts-settings'
import { SliderInput } from '@/shared/ui/property-controls'
import { cn } from '@/shared/ui/cn'
import { i18n } from '@/i18n'
import {
  importMediaAutomationServices,
  importMediaLibraryService,
  resolveMediaUrl,
  useMediaLibraryStore,
} from '@/features/editor/deps/media-library'
import {
  applyCinematicCameraToSelectedImages,
  applyCompoundParallaxCameraToSelectedImages,
  applyDocumentaryCameraToSelectedImages,
  applyMagnates3dCameraToSelectedImages,
  buildDroppedMediaTimelineItem,
  type AudiobookMusicBedPlacement,
  type CinematicDepthLayerPlacement,
  type InsertAudiobookMusicBedResult,
  type InsertCinematicDepthLayersResult,
  useTimelineStore,
} from '@/features/editor/deps/timeline-store'
import {
  createClassicTrack,
  createTextTemplateItem,
  findCompatibleTrackForItemType,
  findNearestAvailableSpace,
} from '@/features/editor/deps/timeline-utils'
import { usePlaybackStore } from '@/shared/state/playback'
import { useSelectionStore } from '@/shared/state/selection'
import type {
  AudioItem,
  ImageItem,
  TextItem,
  TimelineItem,
  TimelineTranscriptCaptionCue,
} from '@/types/timeline'
import type { MediaMetadata, MediaTranscript } from '@/types/storage'
import type {
  StudioAudioLicensePolicy,
  StudioAudioProductionState,
  StudioAudioRecoveredCue,
  StudioAudioSourceMetadata,
} from '@/types/studio-audio'
import {
  KOKORO_TTS_BEST_MODEL,
  KOKORO_TTS_VOICE_OPTIONS,
  getKokoroTtsModelOption,
  getKokoroTtsVoiceOption,
  kokoroTtsService,
  type KokoroTtsModel,
  type KokoroTtsVoice,
} from '../services/kokoro-tts-service'
import {
  MOSS_TTS_VOICE_OPTIONS,
  getMossTtsVoiceOption,
  mossTtsService,
  type MossTtsVoice,
} from '../services/moss-tts-service'
import { analyzeStudioAudioScenes } from '../utils/studio-audio-scene-analysis'
import {
  SUPERTONIC_TTS_EXPRESSIVE_TAG_OPTIONS,
  SUPERTONIC_TTS_LANGUAGE_OPTIONS,
  SUPERTONIC_TTS_VOICE_OPTIONS,
  supertonicTtsService,
  type SupertonicTtsLanguageSelection,
  type SupertonicTtsVoice,
} from '../services/supertonic-tts-service'
import {
  DEFAULT_MUSICGEN_MODEL,
  MUSICGEN_MODEL_OPTIONS,
  musicgenService,
  type MusicgenModelId,
} from '../services/musicgen-service'
import { cinematicDepthPrepService } from '../services/cinematic-depth-prep-service'
import {
  freesoundStudioAudioService,
  type FreesoundCueMatch,
  type FreesoundProviderStatus,
} from '../services/freesound-studio-audio-service'
import { pixabayBrollService, type PixabayBrollMatch } from '../services/pixabay-broll-service'
import {
  scoreCinematicReadiness,
  type CinematicReadinessGrade,
  type CinematicReadinessScore,
} from '../utils/cinematic-readiness'
import {
  scoreCinematicTimelineAudit,
  type TimelineCinematicAuditGrade,
  type TimelineCinematicAuditScore,
} from '../utils/cinematic-timeline-audit'
import {
  getAudiobookSfxTimelineVolumeDb,
  planAudiobookSoundEffects,
  type AudiobookSfxCue,
} from '../utils/audiobook-sfx'
import {
  analyzeAudiobookSfxCandidate,
  masterAudiobookSfxFile,
  type AudiobookSfxCandidateScore,
} from '../utils/audiobook-sfx-mastering'
import {
  matchAudiobookSfxLibraryAssets,
  type AudiobookSfxLibraryMatch,
} from '../utils/audiobook-sfx-library'
import { createCinematicDepthSourceId } from '../utils/cinematic-depth-prep'
import { buildCinematicFinishingUpdates } from '../utils/cinematic-finishing'
import {
  planCinematicFreesoundLayers,
  type CinematicFreesoundLayer,
} from '../utils/cinematic-sound-layering'
import { planCinematicStoryTransitions } from '../utils/cinematic-transition-plan'
import {
  isCinematicEditingProfile,
  type CinematicEditingProfile,
  usesMagnates3dGrammar,
  usesStudioDocumentaryGrammar,
} from '../utils/cinematic-editing-profile'
import { describeSourceResolution, isNative4kSource } from '../utils/cinematic-source-quality'
import { planStudioDocumentaryCards } from '../utils/studio-documentary-cards'
import {
  collectStudioAudioCredits,
  downloadStudioAudioCredits,
  formatYouTubeStudioAudioCredits,
} from '../utils/studio-audio-credits'
import { mapAudiobookCuesToStudioAudioPlan } from '../utils/studio-audio-plan'
import { isStudioAudioLicenseAllowed } from '../utils/studio-audio-licensing'
import { planPixabayBroll } from '../utils/pixabay-broll-plan'
import { useProjectStore } from '../deps/projects'
import { getLanguageDisplayName, insertTextAtCursor } from '../utils/tts-ui-helpers'

const MUSIC_PROMPT_PRESETS = [
  {
    labelKey: 'editor.aiPanel.musicPresets.lofiChillLabel',
    promptKey: 'editor.aiPanel.musicPresets.lofiChillPrompt',
  },
  {
    labelKey: 'editor.aiPanel.musicPresets.pop80sLabel',
    promptKey: 'editor.aiPanel.musicPresets.pop80sPrompt',
  },
  {
    labelKey: 'editor.aiPanel.musicPresets.rock90sLabel',
    promptKey: 'editor.aiPanel.musicPresets.rock90sPrompt',
  },
  {
    labelKey: 'editor.aiPanel.musicPresets.upbeatEdmLabel',
    promptKey: 'editor.aiPanel.musicPresets.upbeatEdmPrompt',
  },
  {
    labelKey: 'editor.aiPanel.musicPresets.countryLabel',
    promptKey: 'editor.aiPanel.musicPresets.countryPrompt',
  },
  {
    labelKey: 'editor.aiPanel.musicPresets.lofiElectroLabel',
    promptKey: 'editor.aiPanel.musicPresets.lofiElectroPrompt',
  },
]

interface AudioGeneration {
  id: string
  file: File
  objectUrl: string
  byteSize: number
  duration: number
  textSnippet: string
  voice: string
  model: string
  summary: string
  details: string
  tags: string[]
  /** null = unsaved, string = saved media ID */
  savedMediaId: string | null
  saving: boolean
}

type Generation = AudioGeneration

const AUDIOBOOK_SCORE_VOLUME_DB = -18
const AUDIOBOOK_SCORE_GUIDANCE_SCALE = 3.4
const AUDIOBOOK_SFX_FOREGROUND_AUDITION_TAKE_COUNT = 2
const AUDIOBOOK_SFX_IMPACT_AUDITION_TAKE_COUNT = 3
const AUDIOBOOK_SFX_RESCUE_TAKE_COUNT = 2
const AUDIOBOOK_GENERATED_IMPACT_PREROLL_SECONDS = 0.32

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  return `${(kb / 1024).toFixed(1)} MB`
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function formatDb(value: number | null): string {
  if (value == null) return '-'
  return `${value > 0 ? '+' : ''}${value.toFixed(1)} dB`
}

const MiniAudioPlayer = memo(function MiniAudioPlayer({ src }: { src: string }) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [isSeeking, setIsSeeking] = useState(false)
  const isSeekingRef = useRef(false)
  isSeekingRef.current = isSeeking

  useEffect(() => {
    const el = audioRef.current
    if (!el) return

    const onPlay = () => setIsPlaying(true)
    const onPause = () => setIsPlaying(false)
    const onTimeUpdate = () => {
      if (!isSeekingRef.current) setCurrentTime(el.currentTime)
    }
    const onLoaded = () => setDuration(el.duration)
    const onEnded = () => {
      setIsPlaying(false)
      setCurrentTime(0)
    }

    el.addEventListener('play', onPlay)
    el.addEventListener('pause', onPause)
    el.addEventListener('timeupdate', onTimeUpdate)
    el.addEventListener('loadedmetadata', onLoaded)
    el.addEventListener('ended', onEnded)

    return () => {
      el.pause()
      el.removeEventListener('play', onPlay)
      el.removeEventListener('pause', onPause)
      el.removeEventListener('timeupdate', onTimeUpdate)
      el.removeEventListener('loadedmetadata', onLoaded)
      el.removeEventListener('ended', onEnded)
    }
  }, [])

  const { togglePlay, seekToPercent } = useMediaPlaybackControls(audioRef, duration, setCurrentTime)

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0

  return (
    <div className="flex items-center gap-1.5 rounded-lg border border-border bg-secondary/30 px-1.5 py-1">
      <audio ref={audioRef} src={src} preload="metadata" />
      <button
        type="button"
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm glow-primary-sm transition-colors hover:bg-primary/90"
        onClick={togglePlay}
        aria-label={isPlaying ? i18n.t('preview.player.pause') : i18n.t('preview.player.play')}
      >
        {isPlaying ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3 ml-px" />}
      </button>
      <Slider
        value={[progressPercent]}
        onValueChange={(values) => {
          setIsSeeking(true)
          seekToPercent(values)
        }}
        onValueCommit={() => setIsSeeking(false)}
        max={100}
        step={0.1}
        className="min-w-0 flex-1"
        aria-label={i18n.t('editor.tts.seek')}
      />
      <span className="shrink-0 select-none font-mono text-[10px] tabular-nums text-muted-foreground">
        {formatTime(currentTime)}
        <span className="text-muted-foreground/40"> / </span>
        {formatTime(duration)}
      </span>
    </div>
  )
})

function insertAudioItemAtPlayhead(media: MediaMetadata, blobUrl: string): boolean {
  const { tracks, items, fps, addItem } = useTimelineStore.getState()
  const { activeTrackId, selectItems } = useSelectionStore.getState()

  const targetTrack = findCompatibleTrackForItemType({
    tracks,
    items,
    itemType: 'audio',
    preferredTrackId: activeTrackId,
  })

  if (!targetTrack) return false

  const sourceFps = media.fps || fps
  const durationInFrames = Math.max(1, Math.round(media.duration * fps))
  const sourceDurationFrames = Math.round(media.duration * sourceFps)

  const proposedPosition = usePlaybackStore.getState().currentFrame
  const finalPosition =
    findNearestAvailableSpace(proposedPosition, durationInFrames, targetTrack.id, items) ??
    proposedPosition

  const audioItem: AudioItem = {
    id: crypto.randomUUID(),
    type: 'audio',
    trackId: targetTrack.id,
    from: finalPosition,
    durationInFrames,
    label: media.fileName,
    mediaId: media.id,
    originId: crypto.randomUUID(),
    src: blobUrl,
    sourceStart: 0,
    sourceEnd: sourceDurationFrames,
    sourceDuration: sourceDurationFrames,
    sourceFps,
    trimStart: 0,
    trimEnd: 0,
  }

  addItem(audioItem)

  // addItem may silently drop the item if placement fails; verify it landed.
  const added = useTimelineStore.getState().items.some((i) => i.id === audioItem.id)
  if (added) {
    selectItems([audioItem.id])
  }
  return added
}

function isAudioTimelineItem(item: TimelineItem): item is AudioItem {
  return item.type === 'audio'
}

function isStillImageTimelineItem(item: TimelineItem): item is ImageItem {
  return item.type === 'image' && !/\.gif$/i.test(item.label ?? '')
}

function itemEndFrame(item: TimelineItem): number {
  return item.from + item.durationInFrames
}

function itemsOverlap(left: TimelineItem, right: TimelineItem): boolean {
  return left.from < itemEndFrame(right) && itemEndFrame(left) > right.from
}

function isLikelyAudiobookSfxItem(item: AudioItem, trackName = ''): boolean {
  return /sfx|sound\s*effect|foley|audiobook\s*sfx/i.test(`${item.label ?? ''} ${trackName}`)
}

function getAudiobookMusicBedTargetIds(params: {
  items: TimelineItem[]
  tracksById: Map<string, string>
  narrationItemId: string
}): string[] {
  const narrationItem = params.items.find(
    (item): item is AudioItem => item.id === params.narrationItemId && isAudioTimelineItem(item),
  )
  if (!narrationItem) return []

  return params.items
    .filter(
      (item): item is AudioItem =>
        isAudioTimelineItem(item) &&
        item.id !== narrationItem.id &&
        itemsOverlap(item, narrationItem) &&
        !isLikelyAudiobookSfxItem(item, params.tracksById.get(item.trackId)),
    )
    .map((item) => item.id)
}

function getNarrationDurationSeconds(item: AudioItem, fps: number): number {
  return Math.max(0, item.durationInFrames / Math.max(1, fps))
}

function sourceSecondsToTimelineFrame(item: AudioItem, sourceSeconds: number, fps: number): number {
  const sourceFps = item.sourceFps ?? fps
  const sourceStartSeconds = (item.sourceStart ?? 0) / sourceFps
  const sourceEndSeconds =
    (item.sourceEnd ?? item.sourceDuration ?? item.durationInFrames) / sourceFps
  const clampedSourceSeconds = Math.min(
    Math.max(sourceSeconds, Math.min(sourceStartSeconds, sourceEndSeconds)),
    Math.max(sourceStartSeconds, sourceEndSeconds),
  )
  const speed = Math.max(0.01, item.speed ?? 1)
  const localSeconds = item.isReversed
    ? (sourceEndSeconds - clampedSourceSeconds) / speed
    : (clampedSourceSeconds - sourceStartSeconds) / speed

  return item.from + Math.max(0, Math.round(localSeconds * fps))
}

function buildAudiobookGeneration(params: {
  cue: AudiobookSfxCue
  file: File
  objectUrl: string
  byteSize: number
  duration: number
  modelLabel: string
  musicModel: MusicgenModelId
  requestedDuration: number
  mastered: boolean
  quality: AudiobookSfxCandidateScore
  auditionTakeCount: number
}): AudioGeneration {
  const {
    cue,
    file,
    objectUrl,
    byteSize,
    duration,
    modelLabel,
    musicModel,
    requestedDuration,
    mastered,
    quality,
    auditionTakeCount,
  } = params
  const auditionSummary = auditionTakeCount > 1 ? ` / audition ${auditionTakeCount} takes` : ''
  const qualitySummary = ` / source ${quality.score.toFixed(1)}/10`

  return {
    id: crypto.randomUUID(),
    file,
    objectUrl,
    byteSize,
    duration,
    textSnippet: `${cue.label}: ${cue.sourceText || cue.prompt}`,
    voice: modelLabel,
    model: mastered
      ? `SFX ${requestedDuration}s / mastered${auditionSummary}`
      : `SFX ${requestedDuration}s${auditionSummary}`,
    summary: cue.prompt,
    details: `${modelLabel} / SFX ${requestedDuration}s${qualitySummary} / ${duration > 0 ? `${duration.toFixed(1)}s` : '-'} / ${formatBytes(byteSize)}`,
    tags: [
      'ai-generated',
      'musicgen',
      'audiobook-sfx',
      mastered ? 'cinematic-mastered' : 'raw-generation',
      `audiobook-sfx-source-score:${quality.score.toFixed(1)}`,
      `audiobook-sfx-audition-takes:${auditionTakeCount}`,
      `musicgen-model:${musicModel}`,
      `audiobook-sfx-cue:${cue.id}`,
      `audiobook-sfx-role:${cue.role}`,
    ],
    savedMediaId: null,
    saving: false,
  }
}

function getTranscriptExcerpt(transcript: MediaTranscript, maxLength = 260): string {
  const sourceText = transcript.text || transcript.segments.map((segment) => segment.text).join(' ')
  const normalized = sourceText.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength).trimEnd()}...`
}

function buildAudiobookMusicPrompt(transcript: MediaTranscript): string {
  const excerpt = getTranscriptExcerpt(transcript)
  const storyReference =
    excerpt || 'mysterious cinematic storybook narration with emotional wonder and suspense'

  return [
    'High-end cinematic audiobook underscore bed',
    'warm low strings, soft piano pulses, airy analog pads, subtle suspense, emotional wonder, polished wide stereo studio mix',
    'no vocals, no lyrics, no speech, no narration, no hard drums, no obvious sound effects, leave clear space for dialogue',
    `Story mood reference: ${storyReference}`,
  ].join('. ')
}

function getAudiobookMusicBedDurationSeconds(params: {
  narrationDurationSeconds: number
  musicModel: MusicgenModelId
}): number {
  const definition = getMusicgenModelDefinition(params.musicModel)
  const target = Math.min(
    definition.maxDurationSeconds,
    Math.max(definition.defaultDurationSeconds, params.narrationDurationSeconds),
  )
  return Math.max(definition.minDurationSeconds, Math.round(target))
}

function buildAudiobookMusicGeneration(params: {
  prompt: string
  file: File
  objectUrl: string
  byteSize: number
  duration: number
  modelLabel: string
  musicModel: MusicgenModelId
  requestedDuration: number
}): AudioGeneration {
  const { prompt, file, objectUrl, byteSize, duration, modelLabel, musicModel, requestedDuration } =
    params

  return {
    id: crypto.randomUUID(),
    file,
    objectUrl,
    byteSize,
    duration,
    textSnippet: 'Cinematic audiobook score bed',
    voice: modelLabel,
    model: `score bed ${requestedDuration}s`,
    summary: prompt,
    details: `${modelLabel} / score bed ${requestedDuration}s / ${duration > 0 ? `${duration.toFixed(1)}s` : '-'} / ${formatBytes(byteSize)}`,
    tags: [
      'ai-generated',
      'musicgen',
      'audiobook-music-bed',
      'cinematic-score-bed',
      `musicgen-model:${musicModel}`,
      `musicgen-target:${requestedDuration}s`,
    ],
    savedMediaId: null,
    saving: false,
  }
}

interface AudiobookSfxPlacement {
  mediaId: string
  src: string
  label: string
  audiobookSfxRole: AudiobookSfxCue['role']
  startFrame: number
  durationInFrames: number
  sourceDurationFrames: number
  sourceFps: number
  volume: number
  studioAudioSource?: StudioAudioSourceMetadata
}

interface AudiobookSfxTimelineInsertResult {
  itemCount: number
  duckedMusicBedCount: number
}

interface GeneratedAudiobookMusicBed {
  generation: AudioGeneration
  mediaId: string
  placement: AudiobookMusicBedPlacement
}

interface AudiobookMusicBedAutomationResult {
  generation: AudioGeneration
  mediaId: string
  insertResult: InsertAudiobookMusicBedResult
}

interface AudiobookDepthPrepResult {
  savedMediaIds: string[]
  inserted: InsertCinematicDepthLayersResult
}

interface GeneratedAudiobookCue {
  generation?: AudioGeneration
  mediaId: string
  placement: AudiobookSfxPlacement
  source: 'generated' | 'library' | 'freesound'
}

interface GeneratedAudiobookCueCandidate {
  blob: Blob
  file: File
  duration: number
  quality: AudiobookSfxCandidateScore
  takeIndex: number
  takeCount: number
}

interface AudiobookCueBatchResult {
  generations: AudioGeneration[]
  placements: AudiobookSfxPlacement[]
  savedMediaIds: string[]
  libraryMatchCount: number
  freesoundMatchCount: number
}

function getStudioAudioJobProgress(
  stage: StudioAudioProductionState['job']['stage'],
  completedCount: number,
  totalCount: number,
): number {
  return stage === 'ready' ? 1 : completedCount / Math.max(1, totalCount)
}

function createStudioAudioJobState(params: {
  cues: AudiobookSfxCue[]
  stage: StudioAudioProductionState['job']['stage']
  completedCueIds?: string[]
  failedCueIds?: string[]
  error?: string
}): StudioAudioProductionState['job'] {
  const completedCueIds = params.completedCueIds ?? []
  return {
    id: `studio-audio:${params.cues[0]?.id ?? 'empty'}`,
    stage: params.stage,
    completedCueIds,
    failedCueIds: params.failedCueIds ?? [],
    progress: getStudioAudioJobProgress(params.stage, completedCueIds.length, params.cues.length),
    updatedAt: Date.now(),
    ...(params.error ? { error: params.error } : {}),
  }
}

function createStudioAudioScenes(transcript?: MediaTranscript) {
  return transcript ? analyzeStudioAudioScenes(transcript) : []
}

function createStudioAudioProductionState(params: {
  cues: AudiobookSfxCue[]
  transcript?: MediaTranscript
  policy: StudioAudioLicensePolicy
  credits?: StudioAudioProductionState['credits']
  recoveredCues?: StudioAudioRecoveredCue[]
  stage: StudioAudioProductionState['job']['stage']
  completedCueIds?: string[]
  failedCueIds?: string[]
  error?: string
}): StudioAudioProductionState {
  return {
    schemaVersion: 1,
    licensePolicy: params.policy,
    plan: mapAudiobookCuesToStudioAudioPlan(params.cues),
    scenes: createStudioAudioScenes(params.transcript),
    credits: params.credits ?? [],
    recoveredCues: params.recoveredCues ?? [],
    job: createStudioAudioJobState(params),
    mixPreset: 'cinematic-story',
    narrationLoudnessLufs: -16,
    truePeakDbtp: -1,
    updatedAt: Date.now(),
  }
}

function createStudioAudioRecoveredCue(
  cue: AudiobookSfxCue,
  generatedCue: GeneratedAudiobookCue,
): StudioAudioRecoveredCue {
  const { placement } = generatedCue
  return {
    cueId: cue.id,
    mediaId: generatedCue.mediaId,
    label: placement.label,
    audiobookSfxRole: placement.audiobookSfxRole,
    startFrame: placement.startFrame,
    durationInFrames: placement.durationInFrames,
    sourceDurationFrames: placement.sourceDurationFrames,
    sourceFps: placement.sourceFps,
    volume: placement.volume,
    ...(placement.studioAudioSource ? { studioAudioSource: placement.studioAudioSource } : {}),
  }
}

async function restoreStudioAudioRecoveredPlacements(
  recoveredCues: StudioAudioRecoveredCue[],
): Promise<Array<{ cueId: string; placement: AudiobookSfxPlacement }>> {
  const placements = await Promise.all(
    recoveredCues.map(
      async (
        cue,
      ): Promise<{
        cueId: string
        placement: AudiobookSfxPlacement
      } | null> => {
        const src = await resolveMediaUrl(cue.mediaId)
        if (!src) return null
        return {
          cueId: cue.cueId,
          placement: {
            mediaId: cue.mediaId,
            src,
            label: cue.label,
            audiobookSfxRole: cue.audiobookSfxRole,
            startFrame: cue.startFrame,
            durationInFrames: cue.durationInFrames,
            sourceDurationFrames: cue.sourceDurationFrames,
            sourceFps: cue.sourceFps,
            volume: cue.volume,
            ...(cue.studioAudioSource ? { studioAudioSource: cue.studioAudioSource } : {}),
          },
        }
      },
    ),
  )
  return placements.filter(
    (placement): placement is { cueId: string; placement: AudiobookSfxPlacement } =>
      placement !== null,
  )
}

function getCompatibleStudioAudioRecovery(
  production: StudioAudioProductionState | undefined,
  cues: AudiobookSfxCue[],
): StudioAudioRecoveredCue[] {
  if (!production || production.job.stage === 'ready') return []
  const plannedIds = production.plan.map((event) => event.id)
  if (plannedIds.length !== cues.length || plannedIds.some((id, index) => id !== cues[index]?.id)) {
    return []
  }
  const cueIds = new Set(cues.map((cue) => cue.id))
  return production.recoveredCues.filter((cue) => cueIds.has(cue.cueId))
}

type AudiobookGenerateReadiness =
  | { ok: true; projectId: string; narrationItem: AudioItem }
  | { ok: false; message: string }

interface GeneratedAudioImporter {
  importGeneratedAudio(
    file: File,
    projectId: string,
    options?: { tags?: string[] },
  ): Promise<MediaMetadata>
}

interface GeneratedImageDepthPrepImporter {
  getMediaFile(idOrMedia: string | MediaMetadata): Promise<Blob | null>
  importGeneratedImage(
    file: File,
    projectId: string,
    options?: {
      width?: number
      height?: number
      tags?: string[]
      codec?: string
    },
  ): Promise<MediaMetadata>
}

function buildAudiobookPlacement(params: {
  cue: AudiobookSfxCue
  media: MediaMetadata
  objectUrl: string
  narrationItem: AudioItem
  timelineFps: number
  generatedDuration: number
}): AudiobookSfxPlacement {
  const { cue, media, objectUrl, narrationItem, timelineFps, generatedDuration } = params
  const cueFrame = sourceSecondsToTimelineFrame(narrationItem, cue.startSeconds, timelineFps)
  const preRollFrames =
    cue.role === 'impact' || cue.role === 'transition'
      ? Math.min(
          cueFrame - narrationItem.from,
          Math.round(AUDIOBOOK_GENERATED_IMPACT_PREROLL_SECONDS * timelineFps),
        )
      : 0
  const startFrame = Math.max(narrationItem.from, cueFrame - Math.max(0, preRollFrames))
  const narrationEndFrame = narrationItem.from + narrationItem.durationInFrames
  const durationInFrames = Math.max(
    1,
    Math.min(Math.round(generatedDuration * timelineFps), narrationEndFrame - startFrame),
  )

  return {
    mediaId: media.id,
    src: objectUrl,
    label: cue.label,
    audiobookSfxRole: cue.role,
    startFrame,
    durationInFrames,
    sourceDurationFrames: Math.max(1, Math.round(generatedDuration * (media.fps || timelineFps))),
    sourceFps: media.fps || timelineFps,
    volume: getAudiobookSfxTimelineVolumeDb(cue),
  }
}

function getAudiobookLibraryPlacementDurationSeconds(params: {
  cue: AudiobookSfxCue
  media: MediaMetadata
  requestedDuration: number
}): number {
  const cueDuration = Math.max(0.4, params.cue.endSeconds - params.cue.startSeconds)
  const sourceDuration = params.media.duration > 0 ? params.media.duration : cueDuration

  if (params.cue.role === 'ambience') {
    return Math.max(0.5, Math.min(sourceDuration, Math.max(cueDuration, params.requestedDuration)))
  }

  const roleCap =
    params.cue.role === 'impact' || params.cue.role === 'transition'
      ? Math.min(params.requestedDuration, 6)
      : Math.min(params.requestedDuration, 8)

  return Math.max(0.25, Math.min(sourceDuration, cueDuration, roleCap))
}

function buildAudiobookLibraryPlacement(params: {
  cue: AudiobookSfxCue
  media: MediaMetadata
  objectUrl: string
  narrationItem: AudioItem
  timelineFps: number
  requestedDuration: number
}): AudiobookSfxPlacement {
  const { cue, media, objectUrl, narrationItem, timelineFps, requestedDuration } = params
  const startFrame = sourceSecondsToTimelineFrame(narrationItem, cue.startSeconds, timelineFps)
  const narrationEndFrame = narrationItem.from + narrationItem.durationInFrames
  const sourceDurationSeconds =
    media.duration > 0
      ? media.duration
      : getAudiobookLibraryPlacementDurationSeconds({
          cue,
          media,
          requestedDuration,
        })
  const placementDurationSeconds = getAudiobookLibraryPlacementDurationSeconds({
    cue,
    media,
    requestedDuration,
  })
  const sourceFps = media.fps || timelineFps

  return {
    mediaId: media.id,
    src: objectUrl,
    label: cue.label,
    audiobookSfxRole: cue.role,
    startFrame,
    durationInFrames: Math.max(
      1,
      Math.min(Math.round(placementDurationSeconds * timelineFps), narrationEndFrame - startFrame),
    ),
    sourceDurationFrames: Math.max(1, Math.round(sourceDurationSeconds * sourceFps)),
    sourceFps,
    volume: getAudiobookSfxTimelineVolumeDb(cue),
  }
}

function buildAudiobookMusicBedPlacement(params: {
  media: MediaMetadata
  objectUrl: string
  narrationItem: AudioItem
  timelineFps: number
  generatedDuration: number
}): AudiobookMusicBedPlacement {
  const { media, objectUrl, narrationItem, timelineFps, generatedDuration } = params
  const sourceFps = media.fps || timelineFps

  return {
    mediaId: media.id,
    src: objectUrl,
    label: 'Cinematic Score Bed',
    startFrame: narrationItem.from,
    durationInFrames: narrationItem.durationInFrames,
    sourceDurationFrames: Math.max(1, Math.round(generatedDuration * sourceFps)),
    sourceFps,
    volume: AUDIOBOOK_SCORE_VOLUME_DB,
  }
}

function resolveAudiobookGenerateReadiness(params: {
  projectId: string | null
  narrationItem: AudioItem | null
  isMusicSupported: boolean
  messages: {
    openProject: string
    noNarration: string
    unsupported: string
  }
}): AudiobookGenerateReadiness {
  if (!params.projectId) {
    return { ok: false, message: params.messages.openProject }
  }
  if (!params.narrationItem) {
    return { ok: false, message: params.messages.noNarration }
  }
  if (!params.isMusicSupported) {
    return { ok: false, message: params.messages.unsupported }
  }
  return {
    ok: true,
    projectId: params.projectId,
    narrationItem: params.narrationItem,
  }
}

function matchAudiobookImagesForNarrationIfNeeded(params: {
  shouldMatch: boolean
  imageCount: number
  selectedItemIds: string[]
}): void {
  if (params.imageCount === 0) return

  const timeline = useTimelineStore.getState()
  if (params.shouldMatch) {
    timeline.matchSelectedImagesToAudio(params.selectedItemIds)
  }
}

function buildTimelineTranscriptCues(transcript: MediaTranscript): TimelineTranscriptCaptionCue[] {
  return transcript.segments
    .map((segment, index) => ({
      id: `segment-${index}`,
      startSeconds: Math.max(0, segment.start),
      endSeconds: Math.max(segment.start, segment.end),
      text: segment.text.trim(),
      words: segment.words?.map((word) => ({
        text: word.text,
        startSeconds: Math.max(segment.start, word.start),
        endSeconds: Math.max(word.start, word.end),
      })),
    }))
    .filter((cue) => cue.text && cue.endSeconds > cue.startSeconds)
}

function syncAudiobookTranscriptToTimelineItem(
  narrationItem: AudioItem,
  transcript: MediaTranscript,
): void {
  const cues = buildTimelineTranscriptCues(transcript)
  if (cues.length === 0) return

  useTimelineStore.getState().updateItem(narrationItem.id, {
    transcriptCaptions: {
      type: 'transcript',
      mediaId: transcript.mediaId,
      enabled: narrationItem.transcriptCaptions?.enabled ?? true,
      updatedAt: transcript.updatedAt,
      cues,
      style: narrationItem.transcriptCaptions?.style,
    },
  })
}

async function getDepthPrepSourceBlob(params: {
  item: ImageItem
  mediaLibraryService: GeneratedImageDepthPrepImporter
}): Promise<Blob | null> {
  if (params.item.mediaId) {
    return params.mediaLibraryService.getMediaFile(params.item.mediaId)
  }

  const response = await fetch(params.item.src)
  return response.ok ? response.blob() : null
}

function isDepthPrepCandidate(item: ImageItem): boolean {
  return !item.cinematicDepthRole || item.cinematicDepthRole === 'flat'
}

function throwIfDepthPrepAborted(signal: AbortSignal): void {
  if (!signal.aborted) return
  throw new DOMException('Depth preparation was cancelled.', 'AbortError')
}

async function captionAudiobookImagesForStoryIfNeeded(params: {
  shouldCaption: boolean
  selectedImageItems: ImageItem[]
  signal: AbortSignal
  onProgress: (message: string, fraction?: number | null) => void
}): Promise<number> {
  if (!params.shouldCaption) return 0

  const mediaStore = useMediaLibraryStore.getState()
  const mediaIds = [
    ...new Set(
      params.selectedImageItems
        .filter(isDepthPrepCandidate)
        .map((item) => item.mediaId)
        .filter((mediaId): mediaId is string => Boolean(mediaId)),
    ),
  ]
  const candidates = mediaIds
    .map((mediaId) => mediaStore.mediaById[mediaId])
    .filter(
      (media): media is MediaMetadata => media != null && (media.aiCaptions?.length ?? 0) === 0,
    )
  if (candidates.length === 0) return 0

  const { mediaAnalysisService } = await importMediaAutomationServices()
  let analyzedCount = 0
  for (const [index, media] of candidates.entries()) {
    throwIfDepthPrepAborted(params.signal)
    params.onProgress(
      `Understanding still ${index + 1}/${candidates.length}: ${media.fileName}`,
      index / candidates.length,
    )
    if (await mediaAnalysisService.analyzeMedia(media)) analyzedCount += 1
  }
  throwIfDepthPrepAborted(params.signal)
  return analyzedCount
}

async function importPreparedDepthMedia(params: {
  prepared: Awaited<ReturnType<typeof cinematicDepthPrepService.prepareStillImage>>
  projectId: string
  mediaLibraryService: GeneratedImageDepthPrepImporter
}): Promise<{
  backgroundMedia: MediaMetadata
  subjectMedia: MediaMetadata
  depthMapMedia: MediaMetadata
}> {
  const commonOptions = {
    width: params.prepared.width,
    height: params.prepared.height,
    codec: 'png',
  }
  const [backgroundMedia, subjectMedia, depthMapMedia] = await Promise.all([
    params.mediaLibraryService.importGeneratedImage(
      params.prepared.backgroundFile,
      params.projectId,
      {
        ...commonOptions,
        tags: [
          'ai-generated',
          'cinematic-depth',
          'cinematic-depth-background',
          `depth-model:${params.prepared.modelId}`,
          `depth-mask-source:${params.prepared.maskSource}`,
        ],
      },
    ),
    params.mediaLibraryService.importGeneratedImage(params.prepared.subjectFile, params.projectId, {
      ...commonOptions,
      tags: [
        'ai-generated',
        'cinematic-depth',
        'cinematic-depth-subject',
        `depth-model:${params.prepared.modelId}`,
        `depth-mask-source:${params.prepared.maskSource}`,
      ],
    }),
    params.mediaLibraryService.importGeneratedImage(
      params.prepared.depthMapFile,
      params.projectId,
      {
        ...commonOptions,
        tags: [
          'ai-generated',
          'cinematic-depth',
          'cinematic-depth-map',
          `depth-model:${params.prepared.modelId}`,
          `depth-mask-source:${params.prepared.maskSource}`,
        ],
      },
    ),
  ])

  return { backgroundMedia, subjectMedia, depthMapMedia }
}

async function prepareAudiobookDepthLayer(params: {
  item: ImageItem
  index: number
  total: number
  projectId: string
  mediaLibraryService: GeneratedImageDepthPrepImporter
  signal: AbortSignal
  trackObjectUrl: (url: string) => void
  onProgress: (message: string, fraction?: number | null) => void
  t: typeof i18n.t
}): Promise<{
  placement: CinematicDepthLayerPlacement
  savedMediaIds: string[]
} | null> {
  throwIfDepthPrepAborted(params.signal)
  params.onProgress(
    params.t('editor.aiPanel.audiobookPreparingDepth', {
      defaultValue: `Preparing depth ${params.index + 1}/${params.total}: ${params.item.label}`,
      current: params.index + 1,
      total: params.total,
      label: params.item.label,
    }),
    params.total > 0 ? params.index / params.total : null,
  )

  const sourceBlob = await getDepthPrepSourceBlob({
    item: params.item,
    mediaLibraryService: params.mediaLibraryService,
  })
  if (!sourceBlob) return null

  const prepared = await cinematicDepthPrepService.prepareStillImage({
    image: params.item,
    sourceBlob,
    signal: params.signal,
    onProgress: (stage, fraction) => {
      params.onProgress(
        `${stage}: ${params.item.label}`,
        params.total > 0 ? (params.index + (fraction ?? 0)) / params.total : fraction,
      )
    },
  })
  const { backgroundMedia, subjectMedia, depthMapMedia } = await importPreparedDepthMedia({
    prepared,
    projectId: params.projectId,
    mediaLibraryService: params.mediaLibraryService,
  })
  const backgroundUrl = URL.createObjectURL(prepared.backgroundFile)
  const subjectUrl = URL.createObjectURL(prepared.subjectFile)
  const depthMapUrl = URL.createObjectURL(prepared.depthMapFile)
  params.trackObjectUrl(backgroundUrl)
  params.trackObjectUrl(subjectUrl)
  params.trackObjectUrl(depthMapUrl)

  return {
    savedMediaIds: [backgroundMedia.id, subjectMedia.id, depthMapMedia.id],
    placement: {
      sourceItemId: params.item.id,
      depthSourceId: createCinematicDepthSourceId(params.item),
      depthQuality: prepared.quality,
      backgroundAsset: {
        mediaId: backgroundMedia.id,
        src: backgroundUrl,
        label: `${params.item.label} Background Plate`,
        sourceWidth: backgroundMedia.width || prepared.width,
        sourceHeight: backgroundMedia.height || prepared.height,
      },
      subjectAsset: {
        mediaId: subjectMedia.id,
        src: subjectUrl,
        label: `${params.item.label} Subject Cutout`,
        sourceWidth: subjectMedia.width || prepared.width,
        sourceHeight: subjectMedia.height || prepared.height,
      },
      depthMapAsset: {
        mediaId: depthMapMedia.id,
        src: depthMapUrl,
        label: `${params.item.label} Depth Map`,
        sourceWidth: depthMapMedia.width || prepared.width,
        sourceHeight: depthMapMedia.height || prepared.height,
      },
    },
  }
}

async function prepareAudiobookDepthLayersIfNeeded(params: {
  shouldPrepare: boolean
  projectId: string
  selectedImageItems: ImageItem[]
  mediaLibraryService: GeneratedImageDepthPrepImporter
  signal: AbortSignal
  trackObjectUrl: (url: string) => void
  onProgress: (message: string, fraction?: number | null) => void
  t: typeof i18n.t
}): Promise<AudiobookDepthPrepResult | null> {
  if (!params.shouldPrepare || params.selectedImageItems.length === 0) return null
  if (!cinematicDepthPrepService.isSupported()) return null

  const placements: CinematicDepthLayerPlacement[] = []
  const savedMediaIds: string[] = []
  const candidates = params.selectedImageItems.filter(isDepthPrepCandidate)

  for (const [index, item] of candidates.entries()) {
    const result = await prepareAudiobookDepthLayer({
      item,
      index,
      total: candidates.length,
      projectId: params.projectId,
      mediaLibraryService: params.mediaLibraryService,
      signal: params.signal,
      trackObjectUrl: params.trackObjectUrl,
      onProgress: params.onProgress,
      t: params.t,
    })
    if (!result) continue
    placements.push(result.placement)
    savedMediaIds.push(...result.savedMediaIds)
  }

  if (placements.length === 0) return null
  const inserted = useTimelineStore.getState().insertCinematicDepthLayers(placements)
  return { savedMediaIds, inserted }
}

function applyAudiobookCinematicMotionIfNeeded(params: {
  shouldAnimate: boolean
  profile: CinematicEditingProfile
  selectedItemIds: string[]
  depthPrepResult: AudiobookDepthPrepResult | null
}): void {
  if (!params.shouldAnimate) return

  const animatedIds = [
    ...params.selectedItemIds,
    ...(params.depthPrepResult?.inserted.visibleItemIds ?? []),
  ]
  if (animatedIds.length > 0) {
    if (usesMagnates3dGrammar(params.profile)) {
      applyMagnates3dCameraToSelectedImages(animatedIds)
    } else if (params.profile === 'documentary') {
      applyDocumentaryCameraToSelectedImages(animatedIds)
    } else if (params.profile === 'compound-parallax') {
      applyCompoundParallaxCameraToSelectedImages(animatedIds)
    } else {
      applyCinematicCameraToSelectedImages(animatedIds)
    }
  }
}

function applyAudiobookCinematicTransitionsIfNeeded(params: {
  shouldApply: boolean
  profile: CinematicEditingProfile
  selectedItemIds: string[]
  depthPrepResult: AudiobookDepthPrepResult | null
  narrationItemId: string
  fps: number
}): number {
  if (!params.shouldApply) return 0

  const timeline = useTimelineStore.getState()
  const narrationItem = timeline.items.find(
    (item): item is AudioItem => item.id === params.narrationItemId && isAudioTimelineItem(item),
  )
  const imageIds = [
    ...params.selectedItemIds,
    ...(params.depthPrepResult?.inserted.visibleItemIds ?? []),
  ]
  const plan = planCinematicStoryTransitions({
    items: timeline.items,
    selectedImageIds: [...new Set(imageIds)],
    existingTransitions: timeline.transitions,
    narrationItem,
    fps: params.fps,
    profile: params.profile,
  })

  let appliedCount = 0
  for (const transition of plan) {
    const added = useTimelineStore
      .getState()
      .addTransition(
        transition.leftClipId,
        transition.rightClipId,
        'crossfade',
        transition.durationInFrames,
        transition.presentation,
        undefined,
        transition.alignment,
      )
    if (added) appliedCount += 1
  }
  return appliedCount
}

function applyAudiobookCinematicFinishingIfNeeded(params: {
  shouldFinish: boolean
  profile: CinematicEditingProfile
  selectedItemIds: string[]
  depthPrepResult: AudiobookDepthPrepResult | null
}): number {
  if (!params.shouldFinish) return 0

  const targetIds = new Set([
    ...params.selectedItemIds,
    ...(params.depthPrepResult?.inserted.visibleItemIds ?? []),
  ])
  if (targetIds.size === 0) return 0

  const updates = buildCinematicFinishingUpdates(
    useTimelineStore.getState().items,
    targetIds,
    undefined,
    params.profile,
  )

  if (updates.length === 0) return 0
  useTimelineStore.getState().setItemEffects(updates)
  return updates.length
}

interface PixabayMediaImporter {
  importMediaFromUrl(url: string, projectId: string): Promise<MediaMetadata>
  getThumbnailBlobUrl(mediaId: string): Promise<string | null>
}

interface InsertPixabayBrollResult {
  matches: PixabayBrollMatch[]
  itemIds: string[]
  imageItemIds: string[]
  mediaIds: string[]
}

interface InsertPixabayBrollParams {
  shouldInsert: boolean
  transcript: MediaTranscript
  narrationItem: AudioItem
  projectId: string
  projectWidth: number
  projectHeight: number
  fps: number
  strict4k: boolean
  preferImages: boolean
  mediaLibraryService: PixabayMediaImporter
  signal: AbortSignal
  onProgress: (message: string, fraction?: number | null) => void
}

function requireNative4kPixabayMedia(
  media: MediaMetadata,
  match: PixabayBrollMatch,
  strict4k: boolean,
): void {
  if (!strict4k || isNative4kSource({ width: media.width, height: media.height })) return
  throw new Error(
    `Pixabay returned ${describeSourceResolution({ width: media.width, height: media.height })} for "${match.selected.title}". Magnates 3D requires a native 4K source.`,
  )
}

async function importAutomaticPixabayBrollItem(params: {
  match: PixabayBrollMatch
  index: number
  total: number
  trackId: string
  context: InsertPixabayBrollParams
}): Promise<{ item: TimelineItem; mediaId: string }> {
  const { match, context } = params
  context.signal.throwIfAborted()
  context.onProgress(
    `Downloading Pixabay B-roll ${params.index + 1}/${params.total}: ${match.selected.title}`,
    params.index / params.total,
  )
  const media = await context.mediaLibraryService.importMediaFromUrl(
    pixabayBrollService.assetUrl(match.selected),
    context.projectId,
  )
  requireNative4kPixabayMedia(media, match, context.strict4k)
  const blobUrl = await resolveMediaUrl(media.id)
  const thumbnailUrl = await context.mediaLibraryService.getThumbnailBlobUrl(media.id)
  const item = buildDroppedMediaTimelineItem({
    media,
    mediaId: media.id,
    mediaType: match.selected.kind,
    label: `Pixabay: ${match.selected.title}`,
    timelineFps: context.fps,
    blobUrl,
    thumbnailUrl,
    canvasWidth: context.projectWidth,
    canvasHeight: context.projectHeight,
    placement: {
      trackId: params.trackId,
      from: context.narrationItem.from + Math.round(match.beat.startSeconds * context.fps),
      durationInFrames: Math.max(
        1,
        Math.round((match.beat.endSeconds - match.beat.startSeconds) * context.fps),
      ),
    },
  })
  return {
    item: {
      ...item,
      ...(item.type === 'video' ? { embeddedAudioMuted: true } : {}),
      pixabayBrollSource: pixabayBrollService.sourceMetadata(match),
    },
    mediaId: media.id,
  }
}

async function insertAutomaticPixabayBroll(
  params: InsertPixabayBrollParams,
): Promise<InsertPixabayBrollResult> {
  const empty = { matches: [], itemIds: [], imageItemIds: [], mediaIds: [] }
  if (!params.shouldInsert) return empty

  const beats = planPixabayBroll(
    params.transcript,
    params.preferImages
      ? { maxBeatSeconds: 3.2, maxBeats: 18, coverageStyle: 'cinematic' }
      : undefined,
  )
  if (beats.length === 0) return empty
  params.onProgress('Matching narration to Pixabay B-roll', null)
  const matches = await pixabayBrollService.matchBeats(
    beats,
    { strict4k: params.strict4k, preferImages: params.preferImages },
    params.signal,
  )
  if (matches.length === 0)
    throw new Error(
      params.strict4k
        ? 'Pixabay could not find native 4K B-roll for this narration.'
        : 'Pixabay could not find suitable HD B-roll for this narration.',
    )

  const timeline = useTimelineStore.getState()
  const topOrder = Math.min(0, ...timeline.tracks.map((track) => track.order)) - 1
  const track = {
    ...createClassicTrack({ tracks: timeline.tracks, kind: 'video', order: topOrder }),
    name: 'Pixabay B-roll',
  }
  const items: TimelineItem[] = []
  const mediaIds: string[] = []

  for (const [index, match] of matches.entries()) {
    const imported = await importAutomaticPixabayBrollItem({
      match,
      index,
      total: matches.length,
      trackId: track.id,
      context: params,
    })
    items.push(imported.item)
    mediaIds.push(imported.mediaId)
  }

  const first = items.shift()
  if (!first) return empty
  timeline.addItemOnNewTrack(first, [...timeline.tracks, track])
  if (items.length > 0) useTimelineStore.getState().addItems(items)
  const inserted = [first, ...items]
  return {
    matches,
    itemIds: inserted.map((item) => item.id),
    imageItemIds: inserted.filter((item) => item.type === 'image').map((item) => item.id),
    mediaIds,
  }
}

async function prepareAudiobookImagesAndMotion(params: {
  shouldMatch: boolean
  shouldPrepareDepth: boolean
  shouldAnimate: boolean
  shouldFinish: boolean
  profile: CinematicEditingProfile
  projectId: string
  selectedImageItems: ImageItem[]
  selectedItemIds: string[]
  mediaLibraryService: GeneratedImageDepthPrepImporter
  signal: AbortSignal
  trackObjectUrl: (url: string) => void
  onProgress: (message: string, fraction?: number | null) => void
  t: typeof i18n.t
}): Promise<AudiobookDepthPrepResult | null> {
  matchAudiobookImagesForNarrationIfNeeded({
    shouldMatch: params.shouldMatch,
    imageCount: params.selectedImageItems.length,
    selectedItemIds: params.selectedItemIds,
  })
  const depthPrepResult = await prepareAudiobookDepthLayersIfNeeded({
    shouldPrepare: params.shouldPrepareDepth,
    projectId: params.projectId,
    selectedImageItems: params.selectedImageItems,
    mediaLibraryService: params.mediaLibraryService,
    signal: params.signal,
    trackObjectUrl: params.trackObjectUrl,
    onProgress: params.onProgress,
    t: params.t,
  })
  if (depthPrepResult) {
    useSelectionStore
      .getState()
      .selectItems([
        ...new Set([...params.selectedItemIds, ...depthPrepResult.inserted.visibleItemIds]),
      ])
  }
  applyAudiobookCinematicMotionIfNeeded({
    shouldAnimate: params.shouldAnimate,
    profile: params.profile,
    selectedItemIds: params.selectedItemIds,
    depthPrepResult,
  })
  applyAudiobookCinematicFinishingIfNeeded({
    shouldFinish: params.shouldFinish,
    profile: params.profile,
    selectedItemIds: params.selectedItemIds,
    depthPrepResult,
  })
  return depthPrepResult
}

function insertStudioDocumentaryCardsIfNeeded(params: {
  profile: CinematicEditingProfile
  narrationItemId: string
  fps: number
}): number {
  if (!usesStudioDocumentaryGrammar(params.profile)) return 0

  const timeline = useTimelineStore.getState()
  const narrationItem = timeline.items.find(
    (item): item is AudioItem => item.id === params.narrationItemId && isAudioTimelineItem(item),
  )
  const project = useProjectStore.getState().currentProject
  if (!narrationItem || !project) return 0

  const existingLabels = new Set(
    timeline.items
      .filter((item): item is TextItem => item.type === 'text')
      .map((item) => item.label),
  )
  const cards = planStudioDocumentaryCards({
    narrationItem,
    fps: params.fps,
    maxCards: 10,
  }).filter((card) => !existingLabels.has(`Studio card: ${card.text}`))
  if (cards.length === 0) return 0

  const topOrder = Math.min(0, ...timeline.tracks.map((track) => track.order)) - 1
  const titleTrack = {
    ...createClassicTrack({
      tracks: timeline.tracks,
      kind: 'video',
      order: topOrder,
    }),
    name: usesMagnates3dGrammar(params.profile)
      ? 'Magnates Kinetic Titles'
      : 'Studio Documentary Titles',
  }
  const items = cards.map((card, index) => {
    const item = createTextTemplateItem({
      placement: {
        trackId: titleTrack.id,
        from: card.from,
        durationInFrames: card.durationInFrames,
        canvasWidth: project.metadata.width,
        canvasHeight: project.metadata.height,
        fps: params.fps,
      },
      label: `Studio card: ${card.text}`,
      text: card.text,
      textStylePresetId: 'cinematic',
    })
    return usesMagnates3dGrammar(params.profile)
      ? {
          ...item,
          textMotion: {
            in: {
              presetId: 'slide-mask' as const,
              durationFrames: 14,
              staggerFrames: 4,
              intensity: 0.85,
              order: 'forward' as const,
              easing: 'ease-out' as const,
              seed: index,
              unit: 'line' as const,
            },
            out: {
              presetId: 'blur-out' as const,
              durationFrames: 12,
              staggerFrames: 2,
              intensity: 0.65,
              order: 'forward' as const,
              easing: 'ease-in' as const,
              seed: index,
              unit: 'word' as const,
            },
          },
        }
      : item
  })
  const first = items.shift()
  if (!first) return 0
  timeline.addItemOnNewTrack(first, [...timeline.tracks, titleTrack])
  if (items.length > 0) useTimelineStore.getState().addItems(items)
  return cards.length
}

function insertAudiobookSfxAndDuckMusic(params: {
  placements: AudiobookSfxPlacement[]
  narrationItemId: string
}): AudiobookSfxTimelineInsertResult {
  const timelineBeforeInsert = useTimelineStore.getState()
  const tracksById = new Map(timelineBeforeInsert.tracks.map((track) => [track.id, track.name]))
  const musicBedTargetIds = getAudiobookMusicBedTargetIds({
    items: timelineBeforeInsert.items,
    tracksById,
    narrationItemId: params.narrationItemId,
  })
  const insertResult = timelineBeforeInsert.insertAudiobookSoundEffects(params.placements)
  const duckingResult =
    musicBedTargetIds.length > 0
      ? useTimelineStore.getState().applySelectedAudioDucking(musicBedTargetIds)
      : null

  return {
    itemCount: insertResult.itemCount,
    duckedMusicBedCount: duckingResult?.status === 'ducked' ? duckingResult.targetCount : 0,
  }
}

function formatAudiobookInsertedProgress(
  result: AudiobookSfxTimelineInsertResult,
  insertedMusicBedCount: number,
): string {
  const parts = [`Added ${result.itemCount} sound effects`]
  if (insertedMusicBedCount > 0) {
    parts.push(`added ${insertedMusicBedCount} score clips`)
  }
  if (result.duckedMusicBedCount > 0) {
    parts.push(`ducked ${result.duckedMusicBedCount} music beds`)
  }
  return parts.join(', ')
}

function formatAudiobookInsertedProgressWithDepth(
  result: AudiobookSfxTimelineInsertResult,
  depthPrepResult: AudiobookDepthPrepResult | null,
  insertedMusicBedCount = 0,
  transitionLayerCount = 0,
): string {
  const base = formatAudiobookInsertedProgress(result, insertedMusicBedCount)
  const depthLayerCount = depthPrepResult?.inserted.layerCount ?? 0
  const parts = [base]
  if (depthLayerCount > 0) parts.push(`prepared ${depthLayerCount} depth layers`)
  if (transitionLayerCount > 0) parts.push(`directed ${transitionLayerCount} transition layers`)
  return parts.join(', ')
}

function getAudiobookGeneratedMediaIds(params: {
  depthPrepResult: AudiobookDepthPrepResult | null
  musicBedResult: AudiobookMusicBedAutomationResult | null
  batch: AudiobookCueBatchResult
}): string[] {
  return [
    ...(params.depthPrepResult?.savedMediaIds ?? []),
    ...(params.musicBedResult ? [params.musicBedResult.mediaId] : []),
    ...params.batch.savedMediaIds,
  ]
}

function getAudiobookGeneratedAudioHistoryEntries(params: {
  musicBedResult: AudiobookMusicBedAutomationResult | null
  batch: AudiobookCueBatchResult
}): AudioGeneration[] {
  return [
    ...(params.musicBedResult ? [params.musicBedResult.generation] : []),
    ...params.batch.generations,
  ]
}

function formatAudiobookInsertedNotification(
  result: AudiobookSfxTimelineInsertResult,
  insertedMusicBedCount: number,
): string {
  if (insertedMusicBedCount > 0) {
    return `Added ${result.itemCount} audiobook sound effects and ${insertedMusicBedCount} score clips to the timeline.`
  }
  return `Added ${result.itemCount} audiobook sound effects to the timeline.`
}

function getAudiobookGenerateFailureMessage(error: unknown, fallback: string): string | null {
  if (error instanceof DOMException && error.name === 'AbortError') return null
  return error instanceof Error ? error.message : fallback
}

function applyAudiobookGenerateFailure(params: {
  error: unknown
  fallback: string
  setError: Dispatch<SetStateAction<string | null>>
  setProgress: Dispatch<SetStateAction<string | null>>
}): void {
  const message = getAudiobookGenerateFailureMessage(params.error, params.fallback)
  if (!message) {
    params.setProgress(null)
    return
  }
  params.setError(message)
}

function getCinematicReadinessClasses(
  grade: CinematicReadinessGrade | TimelineCinematicAuditGrade,
): string {
  switch (grade) {
    case 'excellent':
      return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-50'
    case 'strong':
      return 'border-sky-500/40 bg-sky-500/10 text-sky-50'
    case 'fair':
      return 'border-amber-500/40 bg-amber-500/10 text-amber-50'
    case 'weak':
      return 'border-destructive/40 bg-destructive/10 text-destructive'
  }
}

function getCinematicReadinessBarClass(
  grade: CinematicReadinessGrade | TimelineCinematicAuditGrade,
): string {
  switch (grade) {
    case 'excellent':
      return 'bg-emerald-400'
    case 'strong':
      return 'bg-sky-400'
    case 'fair':
      return 'bg-amber-400'
    case 'weak':
      return 'bg-destructive'
  }
}

function shouldAuditionAudiobookSfxCue(cue: AudiobookSfxCue, enabled: boolean): boolean {
  if (!enabled) return false
  if (cue.role === 'impact' || cue.role === 'transition') return true
  return cue.role === 'foreground' && cue.mixVolumeDb >= 3.5
}

function getAudiobookSfxAuditionTakeCount(cue: AudiobookSfxCue, enabled: boolean): number {
  if (!shouldAuditionAudiobookSfxCue(cue, enabled)) return 1
  if (cue.role === 'impact' || cue.role === 'transition') {
    return AUDIOBOOK_SFX_IMPACT_AUDITION_TAKE_COUNT
  }
  return AUDIOBOOK_SFX_FOREGROUND_AUDITION_TAKE_COUNT
}

function getAudiobookSfxMinimumSourceScore(cue: AudiobookSfxCue): number {
  if (cue.role === 'impact' || cue.role === 'transition') return 8.9
  if (cue.role === 'foreground') return 8.2
  return 6.9
}

function shouldGenerateAudiobookSfxRescueTake(params: {
  cue: AudiobookSfxCue
  auditionSfx: boolean
  bestQuality: AudiobookSfxCandidateScore
  rescueTakeIndex: number
}): boolean {
  if (!params.auditionSfx) return false
  if (params.rescueTakeIndex >= AUDIOBOOK_SFX_RESCUE_TAKE_COUNT) return false
  if (params.cue.role === 'ambience') return false
  return params.bestQuality.score < getAudiobookSfxMinimumSourceScore(params.cue)
}

function buildAudiobookSfxAuditionPrompt(
  cue: AudiobookSfxCue,
  takeIndex: number,
  rescueTake = false,
): string {
  if (takeIndex === 0) return cue.prompt
  if (rescueTake) {
    return [
      cue.prompt,
      'rescue take because the previous generated source did not meet film-library quality. Create a concrete physical Foley event with theatrical sound-library realism, defined close transient, real low-mid body, audible object contact, textured debris, room slap, controlled headroom, expensive movie post-production tail, no vague pad, no musical loop, no synthetic shimmer, no placeholder sweep, no smooth tonal riser, no clipping, no speech',
    ].join('. ')
  }

  return [
    cue.prompt,
    'alternate cinematic take, stronger theatrical presence, clearer source-recorded character, fuller but controlled body, more premium movie-library detail, obvious tactile transients, audible debris and room slap, avoid synthetic sweeps, avoid cheap placeholder tones, avoid clipped limiter smear, avoid smooth tonal booms, still realistic and non-musical',
  ].join('. ')
}

function selectBestAudiobookCueCandidate(
  candidates: GeneratedAudiobookCueCandidate[],
): GeneratedAudiobookCueCandidate {
  return [...candidates].sort((left, right) => {
    if (right.quality.score !== left.quality.score) {
      return right.quality.score - left.quality.score
    }
    return left.takeIndex - right.takeIndex
  })[0]!
}

async function generateAudiobookCueCandidate(params: {
  cue: AudiobookSfxCue
  musicModel: MusicgenModelId
  requestedDuration: number
  takeIndex: number
  takeCount: number
  progressTakeCount?: number
  rescueTake?: boolean
  signal: AbortSignal
  onProgressPct: (fraction: number | null) => void
}): Promise<GeneratedAudiobookCueCandidate> {
  const progressTakeCount = Math.max(1, params.progressTakeCount ?? params.takeCount)
  const generated = await musicgenService.generateMusicFile({
    prompt: buildAudiobookSfxAuditionPrompt(
      params.cue,
      params.takeIndex,
      params.rescueTake ?? false,
    ),
    model: params.musicModel,
    durationSeconds: params.requestedDuration,
    guidanceScale: params.cue.guidanceScale,
    onProgress: (_stage, fraction) => {
      const base = params.takeIndex / progressTakeCount
      const takeFraction = (fraction ?? 0) / progressTakeCount
      params.onProgressPct(Math.min(1, base + takeFraction))
    },
    signal: params.signal,
  })
  const quality = await analyzeAudiobookSfxCandidate({
    blob: generated.blob,
    cue: params.cue,
    fallbackDuration: generated.duration,
    signal: params.signal,
  })

  return {
    blob: generated.blob,
    file: generated.file,
    duration: generated.duration,
    quality,
    takeIndex: params.takeIndex,
    takeCount: params.takeCount,
  }
}

async function generateBestAudiobookCueCandidate(params: {
  cue: AudiobookSfxCue
  musicModel: MusicgenModelId
  requestedDuration: number
  auditionSfx: boolean
  signal: AbortSignal
  onProgressPct: (fraction: number | null) => void
}): Promise<GeneratedAudiobookCueCandidate> {
  const takeCount = getAudiobookSfxAuditionTakeCount(params.cue, params.auditionSfx)
  const progressTakeCount = takeCount + (params.auditionSfx ? AUDIOBOOK_SFX_RESCUE_TAKE_COUNT : 0)
  const candidates: GeneratedAudiobookCueCandidate[] = []

  for (let takeIndex = 0; takeIndex < takeCount; takeIndex += 1) {
    if (params.signal.aborted) {
      throw new DOMException('Audiobook sound effect generation cancelled', 'AbortError')
    }
    candidates.push(
      await generateAudiobookCueCandidate({
        cue: params.cue,
        musicModel: params.musicModel,
        requestedDuration: params.requestedDuration,
        takeIndex,
        takeCount,
        progressTakeCount,
        signal: params.signal,
        onProgressPct: params.onProgressPct,
      }),
    )
  }

  let best = selectBestAudiobookCueCandidate(candidates)
  for (
    let rescueTakeIndex = 0;
    shouldGenerateAudiobookSfxRescueTake({
      cue: params.cue,
      auditionSfx: params.auditionSfx,
      bestQuality: best.quality,
      rescueTakeIndex,
    });
    rescueTakeIndex += 1
  ) {
    if (params.signal.aborted) {
      throw new DOMException('Audiobook sound effect generation cancelled', 'AbortError')
    }

    candidates.push(
      await generateAudiobookCueCandidate({
        cue: params.cue,
        musicModel: params.musicModel,
        requestedDuration: params.requestedDuration,
        takeIndex: candidates.length,
        takeCount,
        progressTakeCount,
        rescueTake: true,
        signal: params.signal,
        onProgressPct: params.onProgressPct,
      }),
    )
    best = selectBestAudiobookCueCandidate(candidates)
  }

  params.onProgressPct(1)
  return { ...best, takeCount: candidates.length }
}

async function generateAndSaveAudiobookCue(params: {
  cue: AudiobookSfxCue
  modelLabel: string
  musicModel: MusicgenModelId
  requestedDuration: number
  auditionSfx: boolean
  projectId: string
  mediaLibraryService: GeneratedAudioImporter
  narrationItem: AudioItem
  timelineFps: number
  signal: AbortSignal
  onProgressPct: (fraction: number | null) => void
  trackObjectUrl: (url: string) => void
  untrackObjectUrl: (url: string) => void
}): Promise<GeneratedAudiobookCue> {
  const {
    cue,
    modelLabel,
    musicModel,
    requestedDuration,
    auditionSfx,
    projectId,
    mediaLibraryService,
    narrationItem,
    timelineFps,
    signal,
    onProgressPct,
    trackObjectUrl,
    untrackObjectUrl,
  } = params
  const generated = await generateBestAudiobookCueCandidate({
    cue,
    musicModel,
    requestedDuration,
    auditionSfx,
    signal,
    onProgressPct,
  })
  const mastered = await masterAudiobookSfxFile({
    blob: generated.blob,
    file: generated.file,
    cue,
    fallbackDuration: generated.duration,
    signal,
  })

  const objectUrl = URL.createObjectURL(mastered.blob)
  trackObjectUrl(objectUrl)
  const generation = buildAudiobookGeneration({
    cue,
    file: mastered.file,
    objectUrl,
    byteSize: mastered.blob.size,
    duration: mastered.duration,
    modelLabel,
    musicModel,
    requestedDuration,
    mastered: mastered.mastered,
    quality: generated.quality,
    auditionTakeCount: generated.takeCount,
  })
  const media = await mediaLibraryService.importGeneratedAudio(mastered.file, projectId, {
    tags: generation.tags,
  })
  untrackObjectUrl(objectUrl)
  generation.savedMediaId = media.id

  return {
    generation,
    mediaId: media.id,
    source: 'generated',
    placement: buildAudiobookPlacement({
      cue,
      media,
      objectUrl,
      narrationItem,
      timelineFps,
      generatedDuration: mastered.duration,
    }),
  }
}

async function resolveAudiobookLibraryCue(params: {
  match: AudiobookSfxLibraryMatch
  requestedDuration: number
  narrationItem: AudioItem
  timelineFps: number
}): Promise<GeneratedAudiobookCue | null> {
  const objectUrl = await resolveMediaUrl(params.match.media.id)
  if (!objectUrl) return null

  return {
    mediaId: params.match.media.id,
    source: 'library',
    placement: buildAudiobookLibraryPlacement({
      cue: params.match.cue,
      media: params.match.media,
      objectUrl,
      narrationItem: params.narrationItem,
      timelineFps: params.timelineFps,
      requestedDuration: params.requestedDuration,
    }),
  }
}

async function resolveAudiobookFreesoundCue(params: {
  match: FreesoundCueMatch
  layer?: CinematicFreesoundLayer
  preferOriginal: boolean
  projectId: string
  mediaLibraryService: GeneratedAudioImporter
  narrationItem: AudioItem
  timelineFps: number
  requestedDuration: number
  signal: AbortSignal
  trackObjectUrl: (url: string) => void
}): Promise<GeneratedAudiobookCue> {
  const downloaded = await freesoundStudioAudioService.downloadMatch(
    params.match,
    params.preferOriginal,
    params.signal,
  )
  const source = freesoundStudioAudioService.buildSourceMetadata(
    params.match,
    downloaded.sourceKind,
    params.layer?.role,
  )
  const media = await params.mediaLibraryService.importGeneratedAudio(
    downloaded.file,
    params.projectId,
    {
      tags: [
        'studio-audio',
        'freesound',
        `freesound-id:${source.soundId}`,
        `license:${source.licenseCode}`,
        `creator:${source.creator}`,
      ],
    },
  )
  const objectUrl = URL.createObjectURL(downloaded.blob)
  params.trackObjectUrl(objectUrl)
  const placement = buildAudiobookLibraryPlacement({
    cue: params.match.cue,
    media,
    objectUrl,
    narrationItem: params.narrationItem,
    timelineFps: params.timelineFps,
    requestedDuration: params.requestedDuration,
  })
  const offsetFrames = Math.round((params.layer?.offsetSeconds ?? 0) * params.timelineFps)
  return {
    mediaId: media.id,
    source: 'freesound',
    placement: {
      ...placement,
      startFrame: Math.max(params.narrationItem.from, placement.startFrame + offsetFrames),
      volume: placement.volume + (params.layer?.gainDb ?? 0),
      label: `${params.match.cue.label} ${params.layer ? `[${params.layer.role}]` : ''} - ${params.match.selected.name}`,
      studioAudioSource: source,
    },
  }
}

async function generateAndSaveAudiobookMusicBed(params: {
  transcript: MediaTranscript
  modelLabel: string
  musicModel: MusicgenModelId
  projectId: string
  mediaLibraryService: GeneratedAudioImporter
  narrationItem: AudioItem
  narrationDurationSeconds: number
  timelineFps: number
  signal: AbortSignal
  onProgress: (stage: string, fraction?: number | null) => void
  trackObjectUrl: (url: string) => void
  untrackObjectUrl: (url: string) => void
}): Promise<GeneratedAudiobookMusicBed> {
  const requestedDuration = getAudiobookMusicBedDurationSeconds({
    narrationDurationSeconds: params.narrationDurationSeconds,
    musicModel: params.musicModel,
  })
  const prompt = buildAudiobookMusicPrompt(params.transcript)
  const generated = await musicgenService.generateMusicFile({
    prompt,
    model: params.musicModel,
    durationSeconds: requestedDuration,
    guidanceScale: AUDIOBOOK_SCORE_GUIDANCE_SCALE,
    onProgress: (stage, fraction) => params.onProgress(stage, fraction ?? null),
    signal: params.signal,
  })

  const objectUrl = URL.createObjectURL(generated.blob)
  params.trackObjectUrl(objectUrl)
  const generation = buildAudiobookMusicGeneration({
    prompt,
    file: generated.file,
    objectUrl,
    byteSize: generated.blob.size,
    duration: generated.duration,
    modelLabel: params.modelLabel,
    musicModel: params.musicModel,
    requestedDuration,
  })
  const media = await params.mediaLibraryService.importGeneratedAudio(
    generated.file,
    params.projectId,
    {
      tags: generation.tags,
    },
  )
  params.untrackObjectUrl(objectUrl)
  generation.savedMediaId = media.id

  return {
    generation,
    mediaId: media.id,
    placement: buildAudiobookMusicBedPlacement({
      media,
      objectUrl,
      narrationItem: params.narrationItem,
      timelineFps: params.timelineFps,
      generatedDuration: generated.duration,
    }),
  }
}

async function generateAndInsertAudiobookMusicBedIfNeeded(params: {
  shouldGenerate: boolean
  transcript: MediaTranscript
  modelLabel: string
  musicModel: MusicgenModelId
  projectId: string
  mediaLibraryService: GeneratedAudioImporter
  narrationItem: AudioItem
  narrationDurationSeconds: number
  timelineFps: number
  signal: AbortSignal
  t: typeof i18n.t
  setProgress: Dispatch<SetStateAction<string | null>>
  setProgressPct: Dispatch<SetStateAction<number | null>>
  trackObjectUrl: (url: string) => void
  untrackObjectUrl: (url: string) => void
}): Promise<AudiobookMusicBedAutomationResult | null> {
  if (!params.shouldGenerate) return null

  params.setProgress(
    params.t('editor.aiPanel.audiobookGeneratingMusicBed', {
      defaultValue: 'Generating cinematic music bed',
    }),
  )
  params.setProgressPct(null)

  const generatedMusicBed = await generateAndSaveAudiobookMusicBed({
    transcript: params.transcript,
    modelLabel: params.modelLabel,
    musicModel: params.musicModel,
    projectId: params.projectId,
    mediaLibraryService: params.mediaLibraryService,
    narrationItem: params.narrationItem,
    narrationDurationSeconds: params.narrationDurationSeconds,
    timelineFps: params.timelineFps,
    signal: params.signal,
    onProgress: (stage, fraction) => {
      params.setProgress(
        params.t('editor.aiPanel.audiobookGeneratingMusicBedStage', {
          defaultValue: `Generating cinematic music bed: ${stage}`,
          stage,
        }),
      )
      params.setProgressPct(fraction ?? null)
    },
    trackObjectUrl: params.trackObjectUrl,
    untrackObjectUrl: params.untrackObjectUrl,
  })
  const insertResult = useTimelineStore
    .getState()
    .insertAudiobookMusicBed(generatedMusicBed.placement)

  return {
    generation: generatedMusicBed.generation,
    mediaId: generatedMusicBed.mediaId,
    insertResult,
  }
}

async function resolveExistingAudiobookCue(params: {
  libraryMatch?: AudiobookSfxLibraryMatch
  freesoundMatch?: FreesoundCueMatch
  preferFreesoundOriginals: boolean
  projectId: string
  mediaLibraryService: GeneratedAudioImporter
  narrationItem: AudioItem
  timelineFps: number
  requestedDuration: number
  signal: AbortSignal
  onCueStart: (source: 'library' | 'freesound') => void
  onCueProgress: (fraction: number) => void
  trackObjectUrl: (url: string) => void
}): Promise<GeneratedAudiobookCue[] | null> {
  if (params.libraryMatch) {
    params.onCueStart('library')
    const cue = await resolveAudiobookLibraryCue({
      match: params.libraryMatch,
      requestedDuration: params.requestedDuration,
      narrationItem: params.narrationItem,
      timelineFps: params.timelineFps,
    })
    params.onCueProgress(cue ? 1 : 0)
    if (cue) return [cue]
  }
  if (!params.freesoundMatch) return null

  params.onCueStart('freesound')
  try {
    const layers = planCinematicFreesoundLayers(params.freesoundMatch)
    const cues: GeneratedAudiobookCue[] = []
    for (const [index, layer] of layers.entries()) {
      cues.push(
        await resolveAudiobookFreesoundCue({
          match: {
            ...params.freesoundMatch,
            selected: layer.asset,
            alternatives: [],
          },
          layer,
          preferOriginal: params.preferFreesoundOriginals,
          projectId: params.projectId,
          mediaLibraryService: params.mediaLibraryService,
          narrationItem: params.narrationItem,
          timelineFps: params.timelineFps,
          requestedDuration: params.requestedDuration,
          signal: params.signal,
          trackObjectUrl: params.trackObjectUrl,
        }),
      )
      params.onCueProgress((index + 1) / layers.length)
    }
    return cues
  } catch {
    params.onCueProgress(0)
    return null
  }
}

async function generateAudiobookCueBatch(params: {
  cues: AudiobookSfxCue[]
  libraryMatches: AudiobookSfxLibraryMatch[]
  freesoundMatches: FreesoundCueMatch[]
  preferFreesoundOriginals: boolean
  modelLabel: string
  musicModel: MusicgenModelId
  requestedDuration: number
  auditionSfx: boolean
  projectId: string
  mediaLibraryService: GeneratedAudioImporter
  narrationItem: AudioItem
  timelineFps: number
  signal: AbortSignal
  onCueStart: (
    cue: AudiobookSfxCue,
    index: number,
    total: number,
    source: 'generated' | 'library' | 'freesound',
  ) => void
  onCueProgress: (index: number, total: number, fraction: number | null) => void
  onCueCompleted?: (cue: AudiobookSfxCue, generatedCue: GeneratedAudiobookCue) => Promise<void>
  trackObjectUrl: (url: string) => void
  untrackObjectUrl: (url: string) => void
}): Promise<AudiobookCueBatchResult> {
  const result: AudiobookCueBatchResult = {
    generations: [],
    placements: [],
    savedMediaIds: [],
    libraryMatchCount: 0,
    freesoundMatchCount: 0,
  }
  const libraryMatchesByCueId = new Map(params.libraryMatches.map((match) => [match.cue.id, match]))
  const freesoundMatchesByCueId = new Map(
    params.freesoundMatches.map((match) => [match.cue.id, match]),
  )

  for (const [index, cue] of params.cues.entries()) {
    if (params.signal.aborted) {
      throw new DOMException('Audiobook sound effect generation cancelled', 'AbortError')
    }

    const existingCues = await resolveExistingAudiobookCue({
      libraryMatch: libraryMatchesByCueId.get(cue.id),
      freesoundMatch: freesoundMatchesByCueId.get(cue.id),
      preferFreesoundOriginals: params.preferFreesoundOriginals,
      projectId: params.projectId,
      mediaLibraryService: params.mediaLibraryService,
      narrationItem: params.narrationItem,
      timelineFps: params.timelineFps,
      requestedDuration: params.requestedDuration,
      signal: params.signal,
      onCueStart: (source) => params.onCueStart(cue, index, params.cues.length, source),
      onCueProgress: (fraction) => params.onCueProgress(index, params.cues.length, fraction),
      trackObjectUrl: params.trackObjectUrl,
    })
    if (existingCues && existingCues.length > 0) {
      result.libraryMatchCount += existingCues.filter((entry) => entry.source === 'library').length
      result.freesoundMatchCount += existingCues.filter(
        (entry) => entry.source === 'freesound',
      ).length
      result.savedMediaIds.push(...existingCues.map((entry) => entry.mediaId))
      result.placements.push(...existingCues.map((entry) => entry.placement))
      await params.onCueCompleted?.(cue, existingCues[0]!)
      continue
    }

    params.onCueStart(cue, index, params.cues.length, 'generated')
    const generatedCue = await generateAndSaveAudiobookCue({
      cue,
      modelLabel: params.modelLabel,
      musicModel: params.musicModel,
      requestedDuration: params.requestedDuration,
      auditionSfx: params.auditionSfx,
      projectId: params.projectId,
      mediaLibraryService: params.mediaLibraryService,
      narrationItem: params.narrationItem,
      timelineFps: params.timelineFps,
      signal: params.signal,
      onProgressPct: (fraction) => params.onCueProgress(index, params.cues.length, fraction),
      trackObjectUrl: params.trackObjectUrl,
      untrackObjectUrl: params.untrackObjectUrl,
    })

    result.savedMediaIds.push(generatedCue.mediaId)
    if (generatedCue.generation) result.generations.push(generatedCue.generation)
    result.placements.push(generatedCue.placement)
    await params.onCueCompleted?.(cue, generatedCue)
  }

  return result
}

export const AiPanel = memo(function AiPanel() {
  const { t } = useTranslation()
  const currentProjectId = useMediaLibraryStore((state) => state.currentProjectId)
  const mediaItems = useMediaLibraryStore((state) => state.mediaItems)
  const mediaById = useMediaLibraryStore((state) => state.mediaById)
  const loadMediaItems = useMediaLibraryStore((state) => state.loadMediaItems)
  const selectMedia = useMediaLibraryStore((state) => state.selectMedia)
  const showNotification = useMediaLibraryStore((state) => state.showNotification)
  const timelineItems = useTimelineStore((state) => state.items)
  const timelineTracks = useTimelineStore((state) => state.tracks)
  const timelineKeyframes = useTimelineStore((state) => state.keyframes)
  const timelineTransitions = useTimelineStore((state) => state.transitions)
  const timelineFps = useTimelineStore((state) => state.fps)
  const selectedItemIds = useSelectionStore((state) => state.selectedItemIds)
  const currentProject = useProjectStore((state) => state.currentProject)
  const updateStudioAudioProduction = useProjectStore((state) => state.updateStudioAudioProduction)

  const [ttsText, setTtsText] = useState(() => t('editor.aiPanel.defaultTtsPrompt'))
  const [ttsEngine, setTtsEngine] = useState<StoredTtsEngine>(() => getStoredTtsEngine())
  const [ttsKokoroVoice, setTtsKokoroVoice] = useState<KokoroTtsVoice>('af_heart')
  const [ttsMossVoice, setTtsMossVoice] = useState<MossTtsVoice>('Xiaoyu')
  const [ttsSupertonicVoice, setTtsSupertonicVoice] = useState<SupertonicTtsVoice>('M3')
  const [ttsSupertonicLanguage, setTtsSupertonicLanguage] =
    useState<SupertonicTtsLanguageSelection>('auto')
  const ttsModel: KokoroTtsModel = KOKORO_TTS_BEST_MODEL
  const [ttsSpeed, setTtsSpeed] = useState(1)
  const [isTtsGenerating, setIsTtsGenerating] = useState(false)
  const [ttsProgress, setTtsProgress] = useState<string | null>(null)
  const [ttsError, setTtsError] = useState<string | null>(null)
  const [ttsGenerations, setTtsGenerations] = useState<AudioGeneration[]>([])
  const [ttsSectionOpen, setTtsSectionOpen] = useState(true)

  const [musicPrompt, setMusicPrompt] = useState(() => t(MUSIC_PROMPT_PRESETS[0]!.promptKey))
  const [musicModel] = useState<MusicgenModelId>(DEFAULT_MUSICGEN_MODEL)
  const currentMusicModel = useMemo(() => getMusicgenModelDefinition(musicModel), [musicModel])
  const [musicDuration, setMusicDuration] = useState(currentMusicModel.defaultDurationSeconds)
  const [isMusicGenerating, setIsMusicGenerating] = useState(false)
  const [musicProgress, setMusicProgress] = useState<string | null>(null)
  const [musicError, setMusicError] = useState<string | null>(null)
  const [musicGenerations, setMusicGenerations] = useState<AudioGeneration[]>([])
  const [musicProgressPct, setMusicProgressPct] = useState<number | null>(null)
  const [musicInfoOpen, setMusicInfoOpen] = useState(false)
  const [musicSectionOpen, setMusicSectionOpen] = useState(true)

  const [audiobookSectionOpen, setAudiobookSectionOpen] = useState(true)
  const [audiobookEditingProfile, setAudiobookEditingProfile] =
    useState<CinematicEditingProfile>('story')
  const [audiobookMaxCues, setAudiobookMaxCues] = useState(42)
  const [audiobookSfxDuration, setAudiobookSfxDuration] = useState(
    Math.min(
      12,
      Math.max(currentMusicModel.minDurationSeconds, currentMusicModel.defaultDurationSeconds),
    ),
  )
  const [audiobookMatchImages, setAudiobookMatchImages] = useState(true)
  const [audiobookApplyCinematicMotion, setAudiobookApplyCinematicMotion] = useState(true)
  const [audiobookApplyTransitions, setAudiobookApplyTransitions] = useState(true)
  const [audiobookPrepareDepth, setAudiobookPrepareDepth] = useState(true)
  const [audiobookApplyFinishing, setAudiobookApplyFinishing] = useState(true)
  const [audiobookAutoMusicBed, setAudiobookAutoMusicBed] = useState(true)
  const [audiobookUseSfxLibrary, setAudiobookUseSfxLibrary] = useState(false)
  const [audiobookUseFreesound, setAudiobookUseFreesound] = useState(true)
  const [audiobookUsePixabayBroll, setAudiobookUsePixabayBroll] = useState(false)
  const [audiobookStrict4kSources, setAudiobookStrict4kSources] = useState(true)
  const [freesoundLicensePolicy, setFreesoundLicensePolicy] = useState<StudioAudioLicensePolicy>(
    () => currentProject?.studioAudioProduction?.licensePolicy ?? 'cc0-only',
  )
  const [freesoundStatus, setFreesoundStatus] = useState<FreesoundProviderStatus | null>(null)
  const [freesoundStatusError, setFreesoundStatusError] = useState<string | null>(null)
  const [freesoundOauthCode, setFreesoundOauthCode] = useState('')
  const [isFreesoundConnecting, setIsFreesoundConnecting] = useState(false)
  const [audiobookAuditionSfx, setAudiobookAuditionSfx] = useState(true)
  const [audiobookPlan, setAudiobookPlan] = useState<AudiobookSfxCue[]>([])
  const [audiobookReadiness, setAudiobookReadiness] = useState<CinematicReadinessScore | null>(null)
  const [isAudiobookGenerating, setIsAudiobookGenerating] = useState(false)
  const [audiobookProgress, setAudiobookProgress] = useState<string | null>(null)
  const [audiobookError, setAudiobookError] = useState<string | null>(null)
  const [audiobookProgressPct, setAudiobookProgressPct] = useState<number | null>(null)

  const audiobookAbortRef = useRef<AbortController | null>(null)
  const musicAbortRef = useRef<AbortController | null>(null)
  const ttsTextareaRef = useRef<HTMLTextAreaElement>(null)
  const generationUrlsRef = useRef<Set<string>>(new Set())

  // Revoke all blob URLs on unmount
  useEffect(() => {
    setMusicDuration((previous) =>
      Math.min(
        currentMusicModel.maxDurationSeconds,
        Math.max(currentMusicModel.minDurationSeconds, previous),
      ),
    )
    setAudiobookSfxDuration((previous) =>
      Math.min(
        currentMusicModel.maxDurationSeconds,
        Math.max(currentMusicModel.minDurationSeconds, previous),
      ),
    )
  }, [currentMusicModel.maxDurationSeconds, currentMusicModel.minDurationSeconds])

  // Abort in-flight generation and revoke all blob URLs on unmount
  useEffect(() => {
    const urls = generationUrlsRef.current
    return () => {
      audiobookAbortRef.current?.abort()
      audiobookAbortRef.current = null
      musicAbortRef.current?.abort()
      musicAbortRef.current = null
      for (const url of urls) {
        URL.revokeObjectURL(url)
      }
    }
  }, [])

  useEffect(() => {
    setStoredTtsEngine(ttsEngine)
  }, [ttsEngine])

  useEffect(() => {
    if (!audiobookSectionOpen) return
    let cancelled = false
    void freesoundStudioAudioService
      .getStatus()
      .then((status) => {
        if (cancelled) return
        setFreesoundStatus(status)
        setFreesoundStatusError(null)
      })
      .catch((error) => {
        if (cancelled) return
        setFreesoundStatus(null)
        setFreesoundStatusError(
          error instanceof Error ? error.message : 'Studio Audio backend is unavailable.',
        )
      })
    return () => {
      cancelled = true
    }
  }, [audiobookSectionOpen])

  const isKokoroSupported = kokoroTtsService.isSupported()
  const isMossSupported = mossTtsService.isSupported()
  const isSupertonicSupported = supertonicTtsService.isSupported()
  const supportsNativeTtsSpeed = ttsEngine === 'kokoro' || ttsEngine === 'supertonic'
  const ttsSpeedMin = ttsEngine === 'supertonic' ? 0.8 : 0.5
  const ttsSpeedMax = ttsEngine === 'supertonic' ? 1.3 : 2

  useEffect(() => {
    setTtsSpeed((current) => Math.min(ttsSpeedMax, Math.max(ttsSpeedMin, current)))
  }, [ttsSpeedMax, ttsSpeedMin])

  const effectiveTtsSpeed = supportsNativeTtsSpeed ? ttsSpeed : 1
  const isTtsSupported =
    ttsEngine === 'kokoro'
      ? isKokoroSupported
      : ttsEngine === 'moss'
        ? isMossSupported
        : isSupertonicSupported
  const isMusicSupported = musicgenService.isSupported()
  const trimmedTtsText = ttsText.trim()
  const trimmedMusicPrompt = musicPrompt.trim()
  const selectedItemIdSet = useMemo(() => new Set(selectedItemIds), [selectedItemIds])
  const selectedAudioItems = useMemo(
    () =>
      timelineItems.filter(
        (item): item is AudioItem => selectedItemIdSet.has(item.id) && isAudioTimelineItem(item),
      ),
    [selectedItemIdSet, timelineItems],
  )
  const selectedImageItems = useMemo(
    () =>
      timelineItems.filter(
        (item): item is ImageItem =>
          selectedItemIdSet.has(item.id) && isStillImageTimelineItem(item),
      ),
    [selectedItemIdSet, timelineItems],
  )
  const audiobookNarrationItem = selectedAudioItems[0] ?? null
  const audiobookNarrationMedia = audiobookNarrationItem?.mediaId
    ? mediaById[audiobookNarrationItem.mediaId]
    : undefined
  const audiobookNarrationDuration = audiobookNarrationItem
    ? getNarrationDurationSeconds(audiobookNarrationItem, timelineFps)
    : 0
  const audiobookSelectedImageIds = useMemo(
    () => selectedImageItems.map((item) => item.id),
    [selectedImageItems],
  )
  const audiobookMusicBedCount = useMemo(() => {
    if (!audiobookNarrationItem) return 0

    return timelineItems.filter(
      (item) =>
        isAudioTimelineItem(item) &&
        item.id !== audiobookNarrationItem.id &&
        !/audiobook\s*sfx|sfx/i.test(item.label ?? ''),
    ).length
  }, [audiobookNarrationItem, timelineItems])
  const studioAudioCredits = useMemo(
    () => collectStudioAudioCredits(timelineItems, currentProjectId ?? '', timelineFps),
    [currentProjectId, timelineFps, timelineItems],
  )
  const studioAudioItems = useMemo(
    () => timelineItems.filter((item) => item.type === 'audio' && item.studioAudioSource),
    [timelineItems],
  )
  const audiobookTimelineAudit = useMemo<TimelineCinematicAuditScore | null>(() => {
    if (!audiobookNarrationItem) return null

    return scoreCinematicTimelineAudit({
      items: timelineItems,
      tracks: timelineTracks,
      keyframes: timelineKeyframes,
      transitions: timelineTransitions,
      fps: timelineFps,
      narrationItemId: audiobookNarrationItem.id,
      selectedImageIds: audiobookSelectedImageIds,
    })
  }, [
    audiobookNarrationItem,
    audiobookSelectedImageIds,
    timelineFps,
    timelineItems,
    timelineKeyframes,
    timelineTracks,
    timelineTransitions,
  ])

  const totalTtsBytes = useMemo(
    () => ttsGenerations.reduce((sum, generation) => sum + generation.byteSize, 0),
    [ttsGenerations],
  )

  const totalMusicBytes = useMemo(
    () => musicGenerations.reduce((sum, generation) => sum + generation.byteSize, 0),
    [musicGenerations],
  )

  const anyTtsSaving = ttsGenerations.some((generation) => generation.saving)
  const anyMusicSaving = musicGenerations.some((generation) => generation.saving)
  const text = ttsText
  const setText = setTtsText
  const voice =
    ttsEngine === 'kokoro'
      ? ttsKokoroVoice
      : ttsEngine === 'moss'
        ? ttsMossVoice
        : ttsSupertonicVoice
  const speed = ttsSpeed
  const setSpeed = setTtsSpeed
  const isGenerating = isTtsGenerating
  const progress = ttsProgress
  const error = ttsError
  const generations = ttsGenerations
  const totalBytes = totalTtsBytes
  const anySaving = anyTtsSaving
  const trimmedText = trimmedTtsText
  const currentTtsBackendLabel =
    ttsEngine === 'kokoro' ? 'WebGPU' : ttsEngine === 'moss' ? 'CPU' : 'WebGPU/WASM'
  const currentTtsRuntimeLabel =
    ttsEngine === 'kokoro' ? 'Kokoro TTS Best' : ttsEngine === 'moss' ? 'MOSS Nano' : 'Supertonic 3'

  // --- actions ---

  const handleTtsGenerate = useCallback(async () => {
    if (!currentProjectId) {
      setTtsError(t('editor.tts.errors.openProject'))
      return
    }
    if (!trimmedTtsText) {
      setTtsError(t('editor.tts.errors.enterText'))
      return
    }
    if (!isTtsSupported) {
      setTtsError(
        ttsEngine === 'kokoro'
          ? t('editor.tts.errors.kokoroUnsupported')
          : ttsEngine === 'moss'
            ? t('editor.tts.errors.mossUnsupported')
            : t('editor.tts.errors.supertonicUnsupported', {
                defaultValue:
                  'This browser cannot run the local Supertonic TTS runtime. Try a recent Chrome or Edge browser.',
              }),
      )
      return
    }

    setTtsError(null)
    setIsTtsGenerating(true)
    setTtsProgress(t('editor.tts.progressPreparing'))

    try {
      const result =
        ttsEngine === 'kokoro'
          ? await kokoroTtsService.generateSpeechFile({
              text: trimmedTtsText,
              voice: ttsKokoroVoice,
              speed: effectiveTtsSpeed,
              model: ttsModel,
              onProgress: setTtsProgress,
            })
          : ttsEngine === 'moss'
            ? await mossTtsService.generateSpeechFile({
                text: trimmedTtsText,
                voice: ttsMossVoice,
                speed: effectiveTtsSpeed,
                onProgress: setTtsProgress,
              })
            : await supertonicTtsService.generateSpeechFile({
                text: trimmedTtsText,
                voice: ttsSupertonicVoice,
                language: ttsSupertonicLanguage,
                speed: effectiveTtsSpeed,
                onProgress: setTtsProgress,
              })

      const { blob, file, duration } = result

      const objectUrl = URL.createObjectURL(blob)
      generationUrlsRef.current.add(objectUrl)
      const voiceLabel =
        ttsEngine === 'kokoro'
          ? getKokoroTtsVoiceOption(ttsKokoroVoice).label
          : ttsEngine === 'moss'
            ? getMossTtsVoiceOption(ttsMossVoice).label
            : (SUPERTONIC_TTS_VOICE_OPTIONS.find((option) => option.value === ttsSupertonicVoice)
                ?.label ?? ttsSupertonicVoice)
      const modelLabel =
        ttsEngine === 'kokoro'
          ? getKokoroTtsModelOption(ttsModel).label
          : ttsEngine === 'moss'
            ? 'Multilingual Nano'
            : 'Supertonic 3'
      const engineTags =
        ttsEngine === 'kokoro'
          ? [
              'ai-generated',
              'kokoro-tts',
              'tts-engine:kokoro',
              `kokoro-quality:${ttsModel}`,
              `kokoro-voice:${ttsKokoroVoice}`,
            ]
          : ttsEngine === 'moss'
            ? ['ai-generated', 'moss-tts', 'tts-engine:moss', `moss-voice:${ttsMossVoice}`]
            : [
                'ai-generated',
                'supertonic-tts',
                'tts-engine:supertonic',
                `supertonic-voice:${ttsSupertonicVoice}`,
              ]

      const generation: AudioGeneration = {
        id: crypto.randomUUID(),
        file,
        objectUrl,
        byteSize: blob.size,
        duration,
        textSnippet: trimmedTtsText,
        voice: voiceLabel,
        model: modelLabel,
        summary: trimmedTtsText,
        details: `${voiceLabel} / ${modelLabel} / ${duration > 0 ? `${duration.toFixed(1)}s` : '-'} / ${formatBytes(blob.size)}`,
        tags: engineTags,
        savedMediaId: null,
        saving: false,
      }

      setTtsGenerations((prev) => [generation, ...prev])
      setTtsProgress(null)
    } catch (generationError) {
      setTtsError(
        generationError instanceof Error
          ? generationError.message
          : t('editor.tts.errors.generateFailed'),
      )
      setTtsProgress(null)
    } finally {
      setIsTtsGenerating(false)
    }
  }, [
    currentProjectId,
    effectiveTtsSpeed,
    isTtsSupported,
    trimmedTtsText,
    ttsEngine,
    ttsKokoroVoice,
    ttsModel,
    ttsMossVoice,
    ttsSupertonicLanguage,
    ttsSupertonicVoice,
    t,
  ])

  const handleMusicGenerate = useCallback(async () => {
    if (!currentProjectId) return null
    if (!trimmedMusicPrompt) {
      setMusicError(t('editor.aiPanel.errors.describeMusic'))
      return null
    }
    if (!isMusicSupported) {
      setMusicError(t('editor.aiPanel.errors.musicgenUnsupported'))
      return null
    }

    const abortController = new AbortController()
    musicAbortRef.current = abortController

    setMusicError(null)
    setIsMusicGenerating(true)
    setMusicProgress(t('editor.aiPanel.progressPreparingMusic'))
    setMusicProgressPct(null)

    try {
      const { blob, file, duration } = await musicgenService.generateMusicFile({
        prompt: trimmedMusicPrompt,
        model: musicModel,
        durationSeconds: musicDuration,
        onProgress: (stage, fraction) => {
          setMusicProgress(stage)
          setMusicProgressPct(fraction ?? null)
        },
        signal: abortController.signal,
      })

      const objectUrl = URL.createObjectURL(blob)
      generationUrlsRef.current.add(objectUrl)

      const modelLabel =
        MUSICGEN_MODEL_OPTIONS.find((option) => option.value === musicModel)?.label ?? musicModel
      const generation: AudioGeneration = {
        id: crypto.randomUUID(),
        file,
        objectUrl,
        byteSize: blob.size,
        duration,
        textSnippet: trimmedMusicPrompt,
        voice: modelLabel,
        model: `target ${musicDuration}s`,
        summary: trimmedMusicPrompt,
        details: `${modelLabel} / target ${musicDuration}s / ${duration > 0 ? `${duration.toFixed(1)}s` : '-'} / ${formatBytes(blob.size)}`,
        tags: [
          'ai-generated',
          'musicgen',
          `musicgen-model:${musicModel}`,
          `musicgen-target:${musicDuration}s`,
        ],
        savedMediaId: null,
        saving: false,
      }

      setMusicGenerations((prev) => [generation, ...prev])
    } catch (generationError) {
      if (generationError instanceof DOMException && generationError.name === 'AbortError') {
        // Intentional cancellation — no error shown.
      } else {
        setMusicError(
          generationError instanceof Error
            ? generationError.message
            : t('editor.aiPanel.errors.generateMusicFailed'),
        )
      }
    } finally {
      musicAbortRef.current = null
      setIsMusicGenerating(false)
      setMusicProgress(null)
      setMusicProgressPct(null)
    }
  }, [currentProjectId, trimmedMusicPrompt, isMusicSupported, musicModel, musicDuration, t])

  const handleMusicCancel = useCallback(() => {
    musicAbortRef.current?.abort()
  }, [])

  const loadOrCreateAudiobookTranscript = useCallback(async (): Promise<MediaTranscript | null> => {
    if (!audiobookNarrationItem?.mediaId) {
      setAudiobookError(
        t('editor.aiPanel.audiobookNoNarration', {
          defaultValue: 'Select a narration audio clip on the timeline first.',
        }),
      )
      return null
    }

    const { mediaTranscriptionService } = await importMediaAutomationServices()
    const existingTranscript = await mediaTranscriptionService.getTranscript(
      audiobookNarrationItem.mediaId,
    )
    if (existingTranscript) {
      syncAudiobookTranscriptToTimelineItem(audiobookNarrationItem, existingTranscript)
      return existingTranscript
    }

    setAudiobookProgress(
      t('editor.aiPanel.audiobookTranscribing', {
        defaultValue: 'Transcribing narration',
      }),
    )
    setAudiobookProgressPct(null)

    const transcript = await mediaTranscriptionService.transcribeMedia(
      audiobookNarrationItem.mediaId,
      {
        onProgress: (progress) => {
          const pct =
            typeof progress.progress === 'number'
              ? ` (${Math.round(progress.progress * 100)}%)`
              : ''
          setAudiobookProgress(
            t('editor.aiPanel.audiobookTranscribingWithPercent', {
              defaultValue: `Transcribing narration${pct}`,
              percent: pct,
            }),
          )
        },
        onQueueStatusChange: (state) => {
          if (state === 'queued') {
            setAudiobookProgress(
              t('editor.aiPanel.audiobookTranscriptionQueued', {
                defaultValue: 'Queued for narration transcription',
              }),
            )
          }
        },
      },
    )
    syncAudiobookTranscriptToTimelineItem(audiobookNarrationItem, transcript)
    return transcript
  }, [audiobookNarrationItem, t])

  const buildAudiobookCuePlan = useCallback(async (): Promise<{
    transcript: MediaTranscript
    cues: AudiobookSfxCue[]
  } | null> => {
    const transcript = await loadOrCreateAudiobookTranscript()
    if (!transcript) return null

    const cues = planAudiobookSoundEffects(transcript, {
      maxCues: audiobookMaxCues,
      durationSeconds: audiobookSfxDuration,
      narrationDurationSeconds: audiobookNarrationDuration,
    })

    const readinessLibraryMatches = audiobookUseSfxLibrary
      ? matchAudiobookSfxLibraryAssets(cues, mediaItems, {
          excludeMediaIds: audiobookNarrationItem?.mediaId ? [audiobookNarrationItem.mediaId] : [],
        })
      : []
    const readinessLibraryMatchedForegroundCueCount = readinessLibraryMatches.filter(
      (match) => match.cue.role === 'foreground',
    ).length
    const readinessLibraryMatchedImpactCueCount = readinessLibraryMatches.filter(
      (match) => match.cue.role === 'impact' || match.cue.role === 'transition',
    ).length

    if (cues.length === 0) {
      setAudiobookError(
        t('editor.aiPanel.audiobookNoCues', {
          defaultValue: 'No narration cues were found for automatic sound effects.',
        }),
      )
      setAudiobookPlan([])
      setAudiobookReadiness(null)
      return null
    }

    setAudiobookPlan(cues)
    setAudiobookReadiness(
      scoreCinematicReadiness({
        narrationDurationSeconds: audiobookNarrationDuration,
        imageCount: selectedImageItems.length,
        musicBedCount: audiobookAutoMusicBed
          ? Math.max(1, audiobookMusicBedCount)
          : audiobookMusicBedCount,
        cues,
        sfxDurationSeconds: audiobookSfxDuration,
        matchImages: audiobookMatchImages,
        applyCinematicMotion: audiobookApplyCinematicMotion,
        applyTransitions: audiobookApplyTransitions,
        prepareDepth: audiobookPrepareDepth,
        depthPrepSupported: cinematicDepthPrepService.isSupported(),
        applyFinishing: audiobookApplyFinishing,
        useImportedSfxLibrary: audiobookUseSfxLibrary,
        libraryMatchedCueCount: readinessLibraryMatches.length,
        libraryMatchedForegroundCueCount: readinessLibraryMatchedForegroundCueCount,
        libraryMatchedImpactCueCount: readinessLibraryMatchedImpactCueCount,
        transcript,
      }),
    )
    return { transcript, cues }
  }, [
    audiobookApplyCinematicMotion,
    audiobookApplyTransitions,
    audiobookApplyFinishing,
    audiobookAutoMusicBed,
    audiobookMatchImages,
    audiobookMaxCues,
    audiobookMusicBedCount,
    audiobookNarrationItem?.mediaId,
    audiobookNarrationDuration,
    audiobookPrepareDepth,
    audiobookSfxDuration,
    audiobookUseSfxLibrary,
    loadOrCreateAudiobookTranscript,
    mediaItems,
    selectedImageItems.length,
    t,
  ])

  const handleAudiobookAnalyze = useCallback(async () => {
    if (!audiobookNarrationItem) {
      setAudiobookError(
        t('editor.aiPanel.audiobookNoNarration', {
          defaultValue: 'Select a narration audio clip on the timeline first.',
        }),
      )
      return
    }

    setAudiobookError(null)
    setAudiobookProgress(
      t('editor.aiPanel.audiobookAnalyzing', {
        defaultValue: 'Analyzing narration',
      }),
    )
    setAudiobookProgressPct(null)

    try {
      const plan = await buildAudiobookCuePlan()
      if (plan) {
        if (currentProjectId) {
          await updateStudioAudioProduction(
            currentProjectId,
            createStudioAudioProductionState({
              cues: plan.cues,
              transcript: plan.transcript,
              policy: freesoundLicensePolicy,
              credits: studioAudioCredits,
              stage: 'planning',
            }),
          )
        }
        setAudiobookProgress(
          t('editor.aiPanel.audiobookPlanReady', {
            defaultValue: `Planned ${plan.cues.length} sound effects`,
            count: plan.cues.length,
          }),
        )
      }
    } catch (error) {
      setAudiobookError(
        error instanceof Error
          ? error.message
          : t('editor.aiPanel.audiobookAnalyzeFailed', {
              defaultValue: 'Could not analyze the narration.',
            }),
      )
      setAudiobookPlan([])
      setAudiobookReadiness(null)
      setAudiobookProgress(null)
    }
  }, [
    audiobookNarrationItem,
    buildAudiobookCuePlan,
    currentProjectId,
    freesoundLicensePolicy,
    studioAudioCredits,
    t,
    updateStudioAudioProduction,
  ])

  const handleAudiobookCancel = useCallback(() => {
    audiobookAbortRef.current?.abort()
  }, [])

  const refreshFreesoundStatus = useCallback(async () => {
    const status = await freesoundStudioAudioService.getStatus()
    setFreesoundStatus(status)
    setFreesoundStatusError(null)
  }, [])

  const handleFreesoundAuthorize = useCallback(async () => {
    setFreesoundStatusError(null)
    try {
      const authorization = await freesoundStudioAudioService.getAuthorization()
      window.open(authorization.authorizeUrl, '_blank', 'noopener,noreferrer')
    } catch (error) {
      setFreesoundStatusError(
        error instanceof Error ? error.message : 'Could not start Freesound authorization.',
      )
    }
  }, [])

  const handleFreesoundExchange = useCallback(async () => {
    const code = freesoundOauthCode.trim()
    if (!code) return
    setIsFreesoundConnecting(true)
    setFreesoundStatusError(null)
    try {
      await freesoundStudioAudioService.exchangeCode(code)
      setFreesoundOauthCode('')
      await refreshFreesoundStatus()
    } catch (error) {
      setFreesoundStatusError(
        error instanceof Error ? error.message : 'Could not connect Freesound.',
      )
    } finally {
      setIsFreesoundConnecting(false)
    }
  }, [freesoundOauthCode, refreshFreesoundStatus])

  const handleCopyStudioAudioCredits = useCallback(async () => {
    await navigator.clipboard.writeText(formatYouTubeStudioAudioCredits(studioAudioCredits))
    showNotification({
      type: 'success',
      message: 'Audio credits copied for YouTube.',
    })
  }, [showNotification, studioAudioCredits])

  const handleApproveSafeStudioAudio = useCallback(() => {
    for (const item of studioAudioItems) {
      const source = item.studioAudioSource
      if (!source || !isStudioAudioLicenseAllowed(source, freesoundLicensePolicy)) continue
      useTimelineStore.getState().updateItem(item.id, {
        studioAudioSource: { ...source, approval: 'approved' },
      })
    }
    showNotification({
      type: 'success',
      message: 'Safe Studio Audio recommendations approved.',
    })
  }, [freesoundLicensePolicy, showNotification, studioAudioItems])

  const handleReduceStudioAudio = useCallback(() => {
    for (const item of studioAudioItems) {
      useTimelineStore.getState().updateItem(item.id, {
        volume: Math.max(-60, (item.volume ?? 0) - 3),
      })
    }
    showNotification({
      type: 'success',
      message: 'Studio Audio effects reduced by 3 dB.',
    })
  }, [showNotification, studioAudioItems])

  // fallow-ignore-next-line complexity
  const handleAudiobookGenerate = useCallback(async () => {
    const readiness = resolveAudiobookGenerateReadiness({
      projectId: currentProjectId,
      narrationItem: audiobookNarrationItem,
      isMusicSupported,
      messages: {
        openProject: t('editor.tts.errors.openProject', {
          defaultValue: 'Open a project first.',
        }),
        noNarration: t('editor.aiPanel.audiobookNoNarration', {
          defaultValue: 'Select a narration audio clip on the timeline first.',
        }),
        unsupported: t('editor.aiPanel.errors.musicgenUnsupported'),
      },
    })
    if (!readiness.ok) {
      setAudiobookError(readiness.message)
      return
    }

    const abortController = new AbortController()
    audiobookAbortRef.current = abortController
    setIsAudiobookGenerating(true)
    setAudiobookError(null)
    setAudiobookProgress(
      t('editor.aiPanel.audiobookAnalyzing', {
        defaultValue: 'Analyzing narration',
      }),
    )
    setAudiobookProgressPct(null)

    let activePlan: {
      transcript: MediaTranscript
      cues: AudiobookSfxCue[]
    } | null = null
    let checkpointRecoveredCues: StudioAudioRecoveredCue[] = []
    let checkpointCompletedCueIds: string[] = []

    try {
      const plan = await buildAudiobookCuePlan()
      if (!plan) return
      activePlan = plan
      const strict4kSources =
        audiobookStrict4kSources || usesMagnates3dGrammar(audiobookEditingProfile)
      const preferImages = usesMagnates3dGrammar(audiobookEditingProfile)

      if (strict4kSources) {
        const below4k = selectedImageItems.filter((item) => {
          const media = item.mediaId ? mediaById[item.mediaId] : undefined
          return !isNative4kSource({
            width: item.sourceWidth ?? media?.width,
            height: item.sourceHeight ?? media?.height,
          })
        })
        if (below4k.length > 0) {
          const first = below4k[0]
          if (!first) throw new Error('Strict native 4K source validation failed.')
          const media = first.mediaId ? mediaById[first.mediaId] : undefined
          throw new Error(
            `Strict native 4K rejected ${below4k.length} selected image${below4k.length === 1 ? '' : 's'}. "${first.label}" is ${describeSourceResolution({ width: first.sourceWidth ?? media?.width, height: first.sourceHeight ?? media?.height })}; use 3840x2160 or larger.`,
          )
        }
      }

      if (audiobookUseFreesound && !freesoundStatus?.searchConfigured) {
        throw new Error(
          'Licensed Freesound SFX is enabled, but the backend API key is not connected.',
        )
      }
      if (audiobookUsePixabayBroll && !freesoundStatus?.pixabayConfigured) {
        throw new Error(
          'Automatic Pixabay B-roll is enabled, but the backend API key is not connected.',
        )
      }

      const { mediaLibraryService } = await importMediaLibraryService()

      const pixabayBroll = await insertAutomaticPixabayBroll({
        shouldInsert: audiobookUsePixabayBroll,
        transcript: plan.transcript,
        narrationItem: readiness.narrationItem,
        projectId: readiness.projectId,
        projectWidth: currentProject?.metadata.width ?? 1920,
        projectHeight: currentProject?.metadata.height ?? 1080,
        fps: timelineFps,
        strict4k: strict4kSources,
        preferImages,
        mediaLibraryService,
        signal: abortController.signal,
        onProgress: (message, fraction) => {
          setAudiobookProgress(message)
          setAudiobookProgressPct(fraction ?? null)
        },
      })
      const productionVisualItemIds = [...new Set([...selectedItemIds, ...pixabayBroll.itemIds])]
      const pixabayImageItems = useTimelineStore
        .getState()
        .items.filter(
          (item): item is ImageItem =>
            pixabayBroll.imageItemIds.includes(item.id) && isStillImageTimelineItem(item),
        )
      const productionImageItems = [...selectedImageItems, ...pixabayImageItems]

      const storedRecovery = getCompatibleStudioAudioRecovery(
        currentProject?.studioAudioProduction,
        plan.cues,
      )
      const restoredRecovery = await restoreStudioAudioRecoveredPlacements(storedRecovery)
      const restoredCueIds = new Set(restoredRecovery.map((entry) => entry.cueId))
      checkpointRecoveredCues = storedRecovery.filter((cue) => restoredCueIds.has(cue.cueId))
      checkpointCompletedCueIds = [...restoredCueIds]
      const pendingCues = plan.cues.filter((cue) => !restoredCueIds.has(cue.id))

      await captionAudiobookImagesForStoryIfNeeded({
        shouldCaption: audiobookMatchImages,
        selectedImageItems,
        signal: abortController.signal,
        onProgress: (message, fraction) => {
          setAudiobookProgress(message)
          setAudiobookProgressPct(fraction ?? null)
        },
      })

      const depthPrepResult = await prepareAudiobookImagesAndMotion({
        shouldMatch: audiobookMatchImages && pixabayBroll.itemIds.length === 0,
        shouldPrepareDepth: audiobookPrepareDepth,
        shouldAnimate: audiobookApplyCinematicMotion,
        shouldFinish: audiobookApplyFinishing,
        profile: audiobookEditingProfile,
        projectId: readiness.projectId,
        selectedImageItems: productionImageItems,
        mediaLibraryService,
        signal: abortController.signal,
        trackObjectUrl: (url) => generationUrlsRef.current.add(url),
        onProgress: (message, fraction) => {
          setAudiobookProgress(message)
          setAudiobookProgressPct(fraction ?? null)
        },
        t,
        selectedItemIds: productionVisualItemIds,
      })
      const transitionLayerCount = applyAudiobookCinematicTransitionsIfNeeded({
        shouldApply: audiobookApplyTransitions,
        profile: audiobookEditingProfile,
        selectedItemIds: productionVisualItemIds,
        depthPrepResult,
        narrationItemId: readiness.narrationItem.id,
        fps: timelineFps,
      })
      const documentaryCardCount = insertStudioDocumentaryCardsIfNeeded({
        profile: audiobookEditingProfile,
        narrationItemId: readiness.narrationItem.id,
        fps: timelineFps,
      })

      const modelLabel =
        MUSICGEN_MODEL_OPTIONS.find((option) => option.value === musicModel)?.label ?? musicModel
      const musicBedResult = await generateAndInsertAudiobookMusicBedIfNeeded({
        shouldGenerate: audiobookAutoMusicBed && audiobookMusicBedCount === 0,
        transcript: plan.transcript,
        modelLabel,
        musicModel,
        projectId: readiness.projectId,
        mediaLibraryService,
        narrationItem: readiness.narrationItem,
        narrationDurationSeconds: audiobookNarrationDuration,
        timelineFps,
        signal: abortController.signal,
        t,
        setProgress: setAudiobookProgress,
        setProgressPct: setAudiobookProgressPct,
        trackObjectUrl: (url) => generationUrlsRef.current.add(url),
        untrackObjectUrl: (url) => generationUrlsRef.current.delete(url),
      })
      const libraryMatches = audiobookUseSfxLibrary
        ? matchAudiobookSfxLibraryAssets(pendingCues, mediaItems, {
            excludeMediaIds: readiness.narrationItem.mediaId
              ? [readiness.narrationItem.mediaId]
              : [],
          })
        : []
      if (libraryMatches.length > 0) {
        setAudiobookProgress(
          t('editor.aiPanel.audiobookLibraryMatches', {
            defaultValue: `Matched ${libraryMatches.length} cues to imported studio SFX`,
            count: libraryMatches.length,
          }),
        )
        setAudiobookProgressPct(null)
      }

      const locallyMatchedCueIds = new Set(libraryMatches.map((match) => match.cue.id))
      let freesoundMatches: FreesoundCueMatch[] = []
      if (audiobookUseFreesound && freesoundStatus?.searchConfigured) {
        setAudiobookProgress(
          t('editor.aiPanel.audiobookSearchingFreesound', {
            defaultValue: 'Searching the licensed Freesound studio library',
          }),
        )
        setAudiobookProgressPct(null)
        try {
          freesoundMatches = await freesoundStudioAudioService.matchCues(
            pendingCues.filter((cue) => !locallyMatchedCueIds.has(cue.id)),
            freesoundLicensePolicy,
            strict4kSources ? 'cinematic' : 'standard',
            abortController.signal,
          )
        } catch (error) {
          setFreesoundStatusError(
            error instanceof Error
              ? `${error.message} No synthetic replacements were inserted.`
              : 'Freesound search failed. No synthetic replacements were inserted.',
          )
          throw error
        }
        const matchedCueIds = new Set(freesoundMatches.map((match) => match.cue.id))
        const unmatchedCues = pendingCues.filter(
          (cue) => !locallyMatchedCueIds.has(cue.id) && !matchedCueIds.has(cue.id),
        )
        if (unmatchedCues.length > 0) {
          throw new Error(
            `Freesound could not find a CC0 studio recording for ${unmatchedCues.length} planned cue${unmatchedCues.length === 1 ? '' : 's'}. No synthetic replacement was inserted.`,
          )
        }
      }

      const batch = await generateAudiobookCueBatch({
        cues: pendingCues,
        libraryMatches,
        freesoundMatches,
        preferFreesoundOriginals: Boolean(freesoundStatus?.oauthConnected),
        modelLabel,
        musicModel,
        requestedDuration: audiobookSfxDuration,
        auditionSfx: audiobookAuditionSfx,
        projectId: readiness.projectId,
        mediaLibraryService,
        narrationItem: readiness.narrationItem,
        timelineFps,
        signal: abortController.signal,
        onCueStart: (cue, index, total, source) => {
          const defaultValue =
            source === 'library'
              ? `Using library SFX ${index + 1}/${total}: ${cue.label}`
              : source === 'freesound'
                ? `Downloading licensed Freesound ${index + 1}/${total}: ${cue.label}`
                : `Generating SFX ${index + 1}/${total}: ${cue.label}`
          setAudiobookProgress(
            t('editor.aiPanel.audiobookGeneratingCue', {
              defaultValue,
              current: index + 1,
              total,
              label: cue.label,
              source,
            }),
          )
          setAudiobookProgressPct(index / total)
        },
        onCueProgress: (index, total, fraction) => {
          setAudiobookProgressPct((index + (fraction ?? 0)) / total)
        },
        onCueCompleted: async (cue, generatedCue) => {
          checkpointCompletedCueIds = [...new Set([...checkpointCompletedCueIds, cue.id])]
          checkpointRecoveredCues = [
            ...checkpointRecoveredCues.filter((entry) => entry.cueId !== cue.id),
            createStudioAudioRecoveredCue(cue, generatedCue),
          ]
          await updateStudioAudioProduction(
            readiness.projectId,
            createStudioAudioProductionState({
              cues: plan.cues,
              transcript: plan.transcript,
              policy: freesoundLicensePolicy,
              stage: 'downloading',
              completedCueIds: checkpointCompletedCueIds,
              recoveredCues: checkpointRecoveredCues,
            }),
          )
        },
        trackObjectUrl: (url) => generationUrlsRef.current.add(url),
        untrackObjectUrl: (url) => generationUrlsRef.current.delete(url),
      })

      await loadMediaItems()
      selectMedia(
        getAudiobookGeneratedMediaIds({
          depthPrepResult,
          musicBedResult,
          batch,
        }),
      )
      setMusicGenerations((previous) => [
        ...getAudiobookGeneratedAudioHistoryEntries({ musicBedResult, batch }),
        ...previous,
      ])

      const result = insertAudiobookSfxAndDuckMusic({
        placements: [...restoredRecovery.map((entry) => entry.placement), ...batch.placements],
        narrationItemId: readiness.narrationItem.id,
      })
      const completedStudioAudioCredits = collectStudioAudioCredits(
        useTimelineStore.getState().items,
        readiness.projectId,
        timelineFps,
      )
      await updateStudioAudioProduction(
        readiness.projectId,
        createStudioAudioProductionState({
          cues: plan.cues,
          transcript: plan.transcript,
          policy: freesoundLicensePolicy,
          credits: completedStudioAudioCredits,
          stage: 'ready',
          completedCueIds: plan.cues.map((cue) => cue.id),
        }),
      )
      useSelectionStore
        .getState()
        .selectItems([
          ...new Set([
            ...productionVisualItemIds,
            ...(depthPrepResult?.inserted.visibleItemIds ?? []),
          ]),
        ])
      const insertedMusicBedCount = musicBedResult?.insertResult.itemCount ?? 0
      const insertedProgress = formatAudiobookInsertedProgressWithDepth(
        result,
        depthPrepResult,
        insertedMusicBedCount,
        transitionLayerCount,
      )
      const insertedProgressWithSources =
        batch.libraryMatchCount + batch.freesoundMatchCount > 0
          ? `${insertedProgress} (${batch.libraryMatchCount} imported, ${batch.freesoundMatchCount} licensed Freesound)`
          : insertedProgress
      const insertedProgressWithBroll =
        pixabayBroll.itemIds.length > 0
          ? `${insertedProgressWithSources} (${pixabayBroll.itemIds.length} automatic Pixabay B-roll clips)`
          : insertedProgressWithSources
      setAudiobookProgress(
        t('editor.aiPanel.audiobookInserted', {
          defaultValue: insertedProgressWithBroll,
          count: result.itemCount,
          depthLayerCount: depthPrepResult?.inserted.layerCount ?? 0,
          scoreCount: insertedMusicBedCount,
          libraryCount: batch.libraryMatchCount,
        }),
      )
      setAudiobookProgressPct(1)
      const notificationMessage = formatAudiobookInsertedNotification(result, insertedMusicBedCount)
      const notificationMessageWithSources =
        batch.libraryMatchCount + batch.freesoundMatchCount > 0
          ? `${notificationMessage} Used ${batch.libraryMatchCount} imported SFX and ${batch.freesoundMatchCount} licensed Freesound recordings.`
          : notificationMessage
      const completedNotification =
        transitionLayerCount > 0
          ? `${notificationMessageWithSources} Directed ${transitionLayerCount} transition layers.${
              documentaryCardCount > 0 ? ` Added ${documentaryCardCount} editorial cards.` : ''
            }`
          : documentaryCardCount > 0
            ? `${notificationMessageWithSources} Added ${documentaryCardCount} editorial cards.`
            : notificationMessageWithSources
      showNotification({
        type: 'success',
        message: t('editor.aiPanel.audiobookInsertedNotification', {
          defaultValue: completedNotification,
          count: result.itemCount,
          scoreCount: insertedMusicBedCount,
          libraryCount: batch.libraryMatchCount,
        }),
      })
    } catch (error) {
      if (activePlan) {
        const isCancelled = error instanceof DOMException && error.name === 'AbortError'
        try {
          await updateStudioAudioProduction(
            readiness.projectId,
            createStudioAudioProductionState({
              cues: activePlan.cues,
              transcript: activePlan.transcript,
              policy: freesoundLicensePolicy,
              stage: isCancelled ? 'cancelled' : 'failed',
              completedCueIds: checkpointCompletedCueIds,
              recoveredCues: checkpointRecoveredCues,
              ...(isCancelled
                ? {}
                : {
                    error: error instanceof Error ? error.message : 'Studio Audio job failed',
                  }),
            }),
          )
        } catch {
          // Preserve the original generation error when checkpoint persistence also fails.
        }
      }
      applyAudiobookGenerateFailure({
        error,
        fallback: t('editor.aiPanel.audiobookGenerateFailed', {
          defaultValue: 'Could not generate audiobook sound effects.',
        }),
        setError: setAudiobookError,
        setProgress: setAudiobookProgress,
      })
    } finally {
      audiobookAbortRef.current = null
      setIsAudiobookGenerating(false)
      setAudiobookProgressPct(null)
    }
  }, [
    audiobookMatchImages,
    audiobookApplyCinematicMotion,
    audiobookApplyTransitions,
    audiobookPrepareDepth,
    audiobookApplyFinishing,
    audiobookEditingProfile,
    audiobookAutoMusicBed,
    audiobookUseSfxLibrary,
    audiobookUseFreesound,
    audiobookUsePixabayBroll,
    audiobookStrict4kSources,
    audiobookAuditionSfx,
    audiobookMusicBedCount,
    audiobookNarrationItem,
    audiobookNarrationDuration,
    audiobookSfxDuration,
    buildAudiobookCuePlan,
    currentProject?.studioAudioProduction,
    currentProject?.metadata.height,
    currentProject?.metadata.width,
    currentProjectId,
    freesoundLicensePolicy,
    freesoundStatus?.oauthConnected,
    freesoundStatus?.searchConfigured,
    freesoundStatus?.pixabayConfigured,
    isMusicSupported,
    loadMediaItems,
    mediaItems,
    mediaById,
    musicModel,
    selectMedia,
    selectedImageItems,
    selectedItemIds,
    showNotification,
    t,
    timelineFps,
    updateStudioAudioProduction,
  ])

  const updateGenerationInList = useCallback(
    (
      setGenerations: Dispatch<SetStateAction<AudioGeneration[]>>,
      id: string,
      patch: Partial<AudioGeneration>,
    ) => {
      setGenerations((prev) =>
        prev.map((generation) => (generation.id === id ? { ...generation, ...patch } : generation)),
      )
    },
    [],
  )

  const saveGeneration = useCallback(
    async (
      generation: AudioGeneration,
      setGenerations: Dispatch<SetStateAction<AudioGeneration[]>>,
      setError: Dispatch<SetStateAction<string | null>>,
    ): Promise<MediaMetadata | null> => {
      if (!currentProjectId) return null
      updateGenerationInList(setGenerations, generation.id, { saving: true })

      try {
        const { mediaLibraryService } = await importMediaLibraryService()
        const media = await mediaLibraryService.importGeneratedAudio(
          generation.file,
          currentProjectId,
          {
            tags: generation.tags,
          },
        )

        await loadMediaItems()
        selectMedia([media.id])
        // Remove from tracked URLs so unmount cleanup won't revoke a URL
        // that may be referenced by a timeline item's src
        generationUrlsRef.current.delete(generation.objectUrl)
        updateGenerationInList(setGenerations, generation.id, {
          saving: false,
          savedMediaId: media.id,
        })
        return media
      } catch (saveError) {
        setError(
          saveError instanceof Error
            ? saveError.message
            : t('editor.aiPanel.errors.saveAudioFailed'),
        )
        updateGenerationInList(setGenerations, generation.id, {
          saving: false,
        })
        return null
      }
    },
    [currentProjectId, loadMediaItems, selectMedia, t, updateGenerationInList],
  )

  const handleSave = useCallback(
    async (
      generation: AudioGeneration,
      setGenerations: Dispatch<SetStateAction<AudioGeneration[]>>,
      setError: Dispatch<SetStateAction<string | null>>,
    ) => {
      const media = await saveGeneration(generation, setGenerations, setError)
      if (media) {
        showNotification({
          type: 'success',
          message: t('editor.aiPanel.notifications.savedToLibrary', {
            fileName: media.fileName,
          }),
        })
      }
    },
    [saveGeneration, showNotification, t],
  )

  const handleSaveAndInsert = useCallback(
    async (
      generation: AudioGeneration,
      setGenerations: Dispatch<SetStateAction<AudioGeneration[]>>,
      setError: Dispatch<SetStateAction<string | null>>,
    ) => {
      const media = await saveGeneration(generation, setGenerations, setError)
      if (!media) return

      const inserted = insertAudioItemAtPlayhead(media, generation.objectUrl)
      showNotification({
        type: inserted ? 'success' : 'warning',
        message: inserted
          ? t('editor.aiPanel.notifications.savedAndAdded', {
              fileName: media.fileName,
            })
          : t('editor.tts.notifications.savedNoTrack', {
              fileName: media.fileName,
            }),
      })
    },
    [saveGeneration, showNotification, t],
  )

  const removeGenerationFromList = useCallback(
    (setGenerations: Dispatch<SetStateAction<AudioGeneration[]>>, id: string) => {
      setGenerations((prev) => {
        const generation = prev.find((entry) => entry.id === id)
        if (generation) {
          // Only revoke the blob URL if it has not been saved; saved items may
          // have their blob URL referenced by a timeline audio item's `src`.
          if (!generation.savedMediaId) {
            URL.revokeObjectURL(generation.objectUrl)
            generationUrlsRef.current.delete(generation.objectUrl)
          }
        }
        return prev.filter((entry) => entry.id !== id)
      })
    },
    [],
  )

  const clearGenerationList = useCallback(
    (setGenerations: Dispatch<SetStateAction<AudioGeneration[]>>) => {
      // Only revoke blob URLs for unsaved generations; saved ones may be
      // referenced by timeline items.
      setGenerations((prev) => {
        for (const generation of prev) {
          if (!generation.savedMediaId) {
            URL.revokeObjectURL(generation.objectUrl)
            generationUrlsRef.current.delete(generation.objectUrl)
          }
        }
        return []
      })
    },
    [],
  )

  const handleSaveTtsGeneration = useCallback(
    (generation: AudioGeneration) => handleSave(generation, setTtsGenerations, setTtsError),
    [handleSave],
  )
  const handleSaveAndInsertTtsGeneration = useCallback(
    (generation: AudioGeneration) =>
      handleSaveAndInsert(generation, setTtsGenerations, setTtsError),
    [handleSaveAndInsert],
  )
  const handleGenerate = handleTtsGenerate
  const handleClearAll = () => clearGenerationList(setTtsGenerations)
  const handleRemoveGeneration = (id: string) => removeGenerationFromList(setTtsGenerations, id)

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3">
      <div className="space-y-3">
        <Collapsible open={ttsSectionOpen} onOpenChange={setTtsSectionOpen}>
          <div className="-mx-3 -mt-3 bg-secondary/50 px-3 py-2">
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 text-left"
                aria-label={
                  ttsSectionOpen
                    ? t('editor.aiPanel.collapseTextToSpeech')
                    : t('editor.aiPanel.expandTextToSpeech')
                }
              >
                <h2 className="text-sm font-medium">{t('editor.aiPanel.textToSpeech')}</h2>
                <ChevronDown
                  className={cn(
                    'h-4 w-4 text-muted-foreground transition-transform',
                    ttsSectionOpen && 'rotate-180',
                  )}
                />
              </button>
            </CollapsibleTrigger>
          </div>

          <CollapsibleContent className="space-y-4 pt-3">
            {!isTtsSupported && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-100">
                {ttsEngine === 'kokoro'
                  ? t('editor.tts.kokoroUnsupported')
                  : ttsEngine === 'moss'
                    ? t('editor.tts.mossUnsupported')
                    : t('editor.tts.supertonicUnsupported', {
                        defaultValue:
                          'This browser cannot run the local Supertonic TTS runtime. Try a recent Chrome or Edge browser.',
                      })}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="ai-tts-text">{t('editor.tts.text')}</Label>
              <Textarea
                ref={ttsTextareaRef}
                id="ai-tts-text"
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder={t('editor.tts.textPlaceholder')}
                className="min-h-24 resize-y bg-secondary/30 text-sm"
                disabled={isGenerating}
              />
              {ttsEngine === 'supertonic' && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-muted-foreground">
                    {t('editor.tts.expressiveTags', {
                      defaultValue: 'Expressive tags',
                    })}
                  </span>
                  {SUPERTONIC_TTS_EXPRESSIVE_TAG_OPTIONS.map((tag) => (
                    <Button
                      key={tag.value}
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="h-6 px-2 text-[11px]"
                      onClick={() =>
                        insertTextAtCursor({
                          input: ttsTextareaRef.current,
                          insertText: tag.value,
                          setText,
                          text,
                        })
                      }
                      disabled={isGenerating}
                    >
                      {tag.label}
                    </Button>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>{t('editor.tts.engine')}</Label>
                <Select
                  value={ttsEngine}
                  onValueChange={(value) => setTtsEngine(value as StoredTtsEngine)}
                  disabled={isGenerating}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="kokoro" className="text-xs">
                      {t('editor.tts.kokoroOption')}
                    </SelectItem>
                    <SelectItem value="moss" className="text-xs">
                      {t('editor.tts.mossOption')}
                    </SelectItem>
                    <SelectItem value="supertonic" className="text-xs">
                      {t('editor.tts.supertonicOption', {
                        defaultValue: 'Supertonic 3 (31 languages, local ONNX)',
                      })}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-1 gap-3">
                <div className="space-y-1.5">
                  <Label>{t('editor.tts.voice')}</Label>
                  <Select
                    value={voice}
                    onValueChange={(value) => {
                      if (ttsEngine === 'kokoro') {
                        setTtsKokoroVoice(value as KokoroTtsVoice)
                      } else if (ttsEngine === 'moss') {
                        setTtsMossVoice(value as MossTtsVoice)
                      } else {
                        setTtsSupertonicVoice(value as SupertonicTtsVoice)
                      }
                    }}
                    disabled={isGenerating}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      {(ttsEngine === 'kokoro'
                        ? KOKORO_TTS_VOICE_OPTIONS
                        : ttsEngine === 'moss'
                          ? MOSS_TTS_VOICE_OPTIONS
                          : SUPERTONIC_TTS_VOICE_OPTIONS
                      ).map((option) => (
                        <SelectItem key={option.value} value={option.value} className="text-xs">
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {ttsEngine === 'supertonic' && (
                  <div className="space-y-1.5">
                    <Label>{t('editor.tts.language', { defaultValue: 'Language' })}</Label>
                    <Select
                      value={ttsSupertonicLanguage}
                      onValueChange={(value) =>
                        setTtsSupertonicLanguage(value as SupertonicTtsLanguageSelection)
                      }
                      disabled={isGenerating}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="max-h-72">
                        {SUPERTONIC_TTS_LANGUAGE_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value} className="text-xs">
                            {getLanguageDisplayName(
                              option.value,
                              option.label,
                              i18n.language,
                              t('editor.tts.autoDetectLanguage', {
                                defaultValue: 'Auto detect',
                              }),
                            )}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              {supportsNativeTtsSpeed && (
                <SliderInput
                  label={t('editor.tts.speed')}
                  value={speed}
                  onChange={setSpeed}
                  min={ttsSpeedMin}
                  max={ttsSpeedMax}
                  step={0.05}
                  unit="x"
                  disabled={isGenerating}
                />
              )}
              <Button
                size="sm"
                onClick={() => {
                  void handleGenerate()
                }}
                disabled={isGenerating || !trimmedText || !currentProjectId || !isTtsSupported}
                className="h-7 shrink-0 gap-1.5"
              >
                {isGenerating ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <WandSparkles className="h-3.5 w-3.5" />
                )}
                {isGenerating ? t('editor.tts.generating') : t('editor.tts.generate')}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {t('editor.aiPanel.runsLocally', {
                runtime: currentTtsRuntimeLabel,
                backend: currentTtsBackendLabel,
              })}
            </p>

            {progress && (
              <div className="rounded-lg border border-border bg-secondary/20 p-3 text-xs text-muted-foreground">
                {progress}
              </div>
            )}

            {error && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                {error}
              </div>
            )}

            {generations.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">
                    {t('editor.aiPanel.history', {
                      count: generations.length,
                      size: formatBytes(totalBytes),
                    })}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 gap-1 px-2 text-[11px] text-muted-foreground"
                    onClick={handleClearAll}
                    disabled={anySaving}
                  >
                    <Trash2 className="h-3 w-3" />
                    {t('editor.aiPanel.clearAll')}
                  </Button>
                </div>

                <div className="space-y-2">
                  {generations.map((gen) => (
                    <GenerationRow
                      key={gen.id}
                      generation={gen}
                      onSave={handleSaveTtsGeneration}
                      onSaveAndInsert={handleSaveAndInsertTtsGeneration}
                      onRemove={handleRemoveGeneration}
                    />
                  ))}
                </div>
              </div>
            )}
          </CollapsibleContent>
        </Collapsible>

        <Collapsible open={audiobookSectionOpen} onOpenChange={setAudiobookSectionOpen}>
          <div className="-mx-3 bg-secondary/50 px-3 py-2">
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 text-left"
                aria-label={
                  audiobookSectionOpen
                    ? t('editor.aiPanel.collapseAudiobookSfx', {
                        defaultValue: 'Collapse cinematic story edit',
                      })
                    : t('editor.aiPanel.expandAudiobookSfx', {
                        defaultValue: 'Expand cinematic story edit',
                      })
                }
              >
                <h2 className="flex items-center gap-1.5 text-sm font-medium">
                  <Volume2 className="h-3.5 w-3.5 text-muted-foreground" />
                  {t('editor.aiPanel.audiobookSfx', {
                    defaultValue: 'Cinematic Story Edit',
                  })}
                </h2>
                <ChevronDown
                  className={cn(
                    'h-4 w-4 text-muted-foreground transition-transform',
                    audiobookSectionOpen && 'rotate-180',
                  )}
                />
              </button>
            </CollapsibleTrigger>
          </div>

          <CollapsibleContent className="space-y-4 pt-3">
            {!isMusicSupported && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-100">
                {t('editor.aiPanel.musicgenUnsupported')}
              </div>
            )}

            <div className="rounded-lg border border-border bg-secondary/20 p-3 text-xs">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">
                  {t('editor.aiPanel.audiobookNarration', {
                    defaultValue: 'Narration',
                  })}
                </span>
                <span
                  className="max-w-[70%] truncate text-right text-foreground"
                  title={audiobookNarrationMedia?.fileName ?? audiobookNarrationItem?.label}
                >
                  {audiobookNarrationMedia?.fileName ??
                    audiobookNarrationItem?.label ??
                    t('editor.aiPanel.audiobookNoneSelected', {
                      defaultValue: 'None selected',
                    })}
                </span>
              </div>
              <div className="mt-1.5 flex items-center justify-between gap-3">
                <span className="text-muted-foreground">
                  {t('editor.aiPanel.audiobookImages', {
                    defaultValue: 'Still images',
                  })}
                </span>
                <span className="text-foreground">{selectedImageItems.length}</span>
              </div>
              {audiobookNarrationItem && (
                <div className="mt-1.5 flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">
                    {t('editor.aiPanel.audiobookDuration', {
                      defaultValue: 'Duration',
                    })}
                  </span>
                  <span className="font-mono text-foreground">
                    {formatTime(audiobookNarrationDuration)}
                  </span>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-secondary/20 px-3 py-2">
              <Label htmlFor="ai-audiobook-editing-profile" className="text-xs">
                {t('editor.aiPanel.audiobookEditingProfile', {
                  defaultValue: 'Editing style',
                })}
              </Label>
              <Select
                value={audiobookEditingProfile}
                onValueChange={(value) => {
                  if (isCinematicEditingProfile(value)) setAudiobookEditingProfile(value)
                }}
                disabled={isAudiobookGenerating}
              >
                <SelectTrigger
                  id="ai-audiobook-editing-profile"
                  className="h-7 w-[13.5rem] max-w-full text-xs"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="story">
                    {t('editor.aiPanel.audiobookProfileStory', {
                      defaultValue: 'Cinematic story',
                    })}
                  </SelectItem>
                  <SelectItem value="compound-parallax">
                    {t('editor.aiPanel.audiobookProfileCompoundParallax', {
                      defaultValue: 'High-end compound parallax',
                    })}
                  </SelectItem>
                  <SelectItem value="documentary">
                    {t('editor.aiPanel.audiobookProfileDocumentary', {
                      defaultValue: 'Studio documentary',
                    })}
                  </SelectItem>
                  <SelectItem value="magnates-3d">
                    {t('editor.aiPanel.audiobookProfileMagnates3d', {
                      defaultValue: 'Magnates 3D documentary',
                    })}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-1 gap-3">
              <SliderInput
                label={t('editor.aiPanel.audiobookCueCount', {
                  defaultValue: 'SFX count',
                })}
                value={audiobookMaxCues}
                onChange={(value) => setAudiobookMaxCues(Math.round(value))}
                min={1}
                max={48}
                step={1}
                disabled={isAudiobookGenerating}
              />
              <SliderInput
                label={t('editor.aiPanel.audiobookSfxLength', {
                  defaultValue: 'SFX length',
                })}
                value={audiobookSfxDuration}
                onChange={(value) => setAudiobookSfxDuration(Math.round(value))}
                min={currentMusicModel.minDurationSeconds}
                max={currentMusicModel.maxDurationSeconds}
                step={1}
                unit="s"
                disabled={isAudiobookGenerating}
              />
            </div>

            <div className="space-y-1 rounded-lg border border-border bg-secondary/20 px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="ai-audiobook-use-pixabay" className="text-xs">
                  {t('editor.aiPanel.audiobookUsePixabayBroll', {
                    defaultValue: 'Automatic Pixabay B-roll',
                  })}
                </Label>
                <Switch
                  id="ai-audiobook-use-pixabay"
                  checked={audiobookUsePixabayBroll}
                  onCheckedChange={setAudiobookUsePixabayBroll}
                  disabled={isAudiobookGenerating || !freesoundStatus?.pixabayConfigured}
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                {freesoundStatus?.pixabayConfigured
                  ? usesMagnates3dGrammar(audiobookEditingProfile)
                    ? 'Narration matched to native 4K stills for automatic depth animation'
                    : 'Narration matched automatically, videos first with still fallback'
                  : 'Backend API key required'}
              </p>
            </div>

            <div className="space-y-1 rounded-lg border border-border bg-secondary/20 px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="ai-audiobook-strict-4k" className="text-xs">
                  {t('editor.aiPanel.audiobookStrict4kSources', {
                    defaultValue: 'Strict native 4K sources',
                  })}
                </Label>
                <Switch
                  id="ai-audiobook-strict-4k"
                  checked={
                    audiobookStrict4kSources || usesMagnates3dGrammar(audiobookEditingProfile)
                  }
                  onCheckedChange={setAudiobookStrict4kSources}
                  disabled={isAudiobookGenerating || usesMagnates3dGrammar(audiobookEditingProfile)}
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                Rejects images and video below 3840x2160; always on for Magnates 3D
              </p>
            </div>

            <div className="space-y-2 rounded-lg border border-border bg-secondary/20 p-3">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="ai-audiobook-use-freesound" className="text-xs">
                  {t('editor.aiPanel.audiobookUseFreesound', {
                    defaultValue: 'Licensed Freesound studio SFX',
                  })}
                </Label>
                <Switch
                  id="ai-audiobook-use-freesound"
                  checked={audiobookUseFreesound}
                  onCheckedChange={setAudiobookUseFreesound}
                  disabled={isAudiobookGenerating}
                />
              </div>

              <div className="flex items-center justify-between gap-3">
                <span className="text-[11px] text-muted-foreground">
                  {freesoundStatus?.searchConfigured
                    ? freesoundStatus.oauthConnected
                      ? 'Original files connected'
                      : 'High-quality previews ready'
                    : 'Backend API key required'}
                </span>
                <Select
                  value={freesoundLicensePolicy}
                  onValueChange={(value) => {
                    if (value === 'youtube-safe' || value === 'cc0-only') {
                      setFreesoundLicensePolicy(value)
                    }
                  }}
                  disabled={isAudiobookGenerating}
                >
                  <SelectTrigger
                    className="h-7 w-[8.5rem] text-xs"
                    aria-label="Freesound licence policy"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="youtube-safe">CC0 + CC BY</SelectItem>
                    <SelectItem value="cc0-only">CC0 only</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {freesoundStatus?.oauthConfigured && !freesoundStatus.oauthConnected && (
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      void handleFreesoundAuthorize()
                    }}
                    className="h-7 shrink-0 gap-1.5"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Connect
                  </Button>
                  <Input
                    value={freesoundOauthCode}
                    onChange={(event) => setFreesoundOauthCode(event.target.value)}
                    placeholder="Authorization code"
                    aria-label="Freesound authorization code"
                    className="h-7 min-w-0 text-xs"
                    disabled={isFreesoundConnecting}
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={() => {
                      void handleFreesoundExchange()
                    }}
                    disabled={!freesoundOauthCode.trim() || isFreesoundConnecting}
                    className="h-7 w-7 shrink-0"
                    aria-label="Submit Freesound authorization code"
                  >
                    {isFreesoundConnecting ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>
              )}

              {freesoundStatusError && (
                <p className="text-[11px] leading-relaxed text-destructive">
                  {freesoundStatusError}
                </p>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-secondary/20 px-3 py-2">
              <Label htmlFor="ai-audiobook-auto-music-bed" className="text-xs">
                {t('editor.aiPanel.audiobookAutoMusicBed', {
                  defaultValue: 'Auto cinematic score bed',
                })}
              </Label>
              <Switch
                id="ai-audiobook-auto-music-bed"
                checked={audiobookAutoMusicBed}
                onCheckedChange={setAudiobookAutoMusicBed}
                disabled={isAudiobookGenerating}
              />
            </div>

            <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-secondary/20 px-3 py-2">
              <Label htmlFor="ai-audiobook-use-sfx-library" className="text-xs">
                {t('editor.aiPanel.audiobookUseSfxLibrary', {
                  defaultValue: 'Use imported SFX first',
                })}
              </Label>
              <Switch
                id="ai-audiobook-use-sfx-library"
                checked={audiobookUseSfxLibrary}
                onCheckedChange={setAudiobookUseSfxLibrary}
                disabled={isAudiobookGenerating}
              />
            </div>

            <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-secondary/20 px-3 py-2">
              <Label htmlFor="ai-audiobook-audition-sfx" className="text-xs">
                {t('editor.aiPanel.audiobookAuditionSfx', {
                  defaultValue: 'Audition stronger SFX takes',
                })}
              </Label>
              <Switch
                id="ai-audiobook-audition-sfx"
                checked={audiobookAuditionSfx}
                onCheckedChange={setAudiobookAuditionSfx}
                disabled={isAudiobookGenerating}
              />
            </div>

            <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-secondary/20 px-3 py-2">
              <Label htmlFor="ai-audiobook-match-images" className="text-xs">
                {t('editor.aiPanel.audiobookMatchImages', {
                  defaultValue: 'Match images to narration',
                })}
              </Label>
              <Switch
                id="ai-audiobook-match-images"
                checked={audiobookMatchImages}
                onCheckedChange={setAudiobookMatchImages}
                disabled={
                  isAudiobookGenerating ||
                  (selectedImageItems.length === 0 && !audiobookUsePixabayBroll)
                }
              />
            </div>

            <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-secondary/20 px-3 py-2">
              <Label htmlFor="ai-audiobook-cinematic-motion" className="text-xs">
                {t('editor.aiPanel.audiobookCinematicMotion', {
                  defaultValue: 'Cinematic image motion',
                })}
              </Label>
              <Switch
                id="ai-audiobook-cinematic-motion"
                checked={audiobookApplyCinematicMotion}
                onCheckedChange={setAudiobookApplyCinematicMotion}
                disabled={
                  isAudiobookGenerating ||
                  (selectedImageItems.length === 0 && !audiobookUsePixabayBroll)
                }
              />
            </div>

            <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-secondary/20 px-3 py-2">
              <Label htmlFor="ai-audiobook-cinematic-transitions" className="text-xs">
                {t('editor.aiPanel.audiobookCinematicTransitions', {
                  defaultValue: 'Story-directed cut effects',
                })}
              </Label>
              <Switch
                id="ai-audiobook-cinematic-transitions"
                checked={audiobookApplyTransitions}
                onCheckedChange={setAudiobookApplyTransitions}
                disabled={isAudiobookGenerating}
              />
            </div>

            <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-secondary/20 px-3 py-2">
              <Label htmlFor="ai-audiobook-depth-prep" className="text-xs">
                {t('editor.aiPanel.audiobookDepthPrep', {
                  defaultValue: 'Depth-map parallax layers',
                })}
              </Label>
              <Switch
                id="ai-audiobook-depth-prep"
                checked={audiobookPrepareDepth}
                onCheckedChange={setAudiobookPrepareDepth}
                disabled={
                  isAudiobookGenerating ||
                  (selectedImageItems.length === 0 && !audiobookUsePixabayBroll) ||
                  !cinematicDepthPrepService.isSupported()
                }
              />
            </div>

            <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-secondary/20 px-3 py-2">
              <Label htmlFor="ai-audiobook-finishing" className="text-xs">
                {t('editor.aiPanel.audiobookFinishing', {
                  defaultValue: 'Cinematic finishing',
                })}
              </Label>
              <Switch
                id="ai-audiobook-finishing"
                checked={audiobookApplyFinishing}
                onCheckedChange={setAudiobookApplyFinishing}
                disabled={
                  isAudiobookGenerating ||
                  (selectedImageItems.length === 0 && !audiobookUsePixabayBroll)
                }
              />
            </div>

            {audiobookReadiness && (
              <div
                className={cn(
                  'space-y-2 rounded-lg border p-3 text-xs',
                  getCinematicReadinessClasses(audiobookReadiness.grade),
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium">
                    {t('editor.aiPanel.cinematicReadiness', {
                      defaultValue: 'Cinematic readiness',
                    })}
                  </span>
                  <span className="font-mono text-[11px]">
                    {audiobookReadiness.score.toFixed(1)}/10
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-background/45">
                  <div
                    className={cn(
                      'h-full rounded-full transition-[width] duration-300',
                      getCinematicReadinessBarClass(audiobookReadiness.grade),
                    )}
                    style={{
                      width: `${Math.round(audiobookReadiness.score * 10)}%`,
                    }}
                  />
                </div>
                <p className="leading-relaxed opacity-90">{audiobookReadiness.summary}</p>
                <div className="grid grid-cols-3 gap-1.5 text-[11px] opacity-90">
                  <span>
                    {t('editor.aiPanel.readinessImages', {
                      defaultValue: 'Images',
                    })}
                    : {selectedImageItems.length}/{audiobookReadiness.metrics.minimumImageCount}
                  </span>
                  <span>
                    {t('editor.aiPanel.readinessSfx', {
                      defaultValue: 'SFX/min',
                    })}
                    : {audiobookReadiness.metrics.cueDensityPerMinute.toFixed(1)}
                  </span>
                  <span>
                    {t('editor.aiPanel.readinessMusic', {
                      defaultValue: 'Music',
                    })}
                    : {audiobookMusicBedCount > 0 ? 'yes' : audiobookAutoMusicBed ? 'auto' : 'no'}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-1.5 text-[11px] opacity-90">
                  <span>
                    {t('editor.aiPanel.readinessForeground', {
                      defaultValue: 'FG',
                    })}
                    : {audiobookReadiness.metrics.foregroundCueCount}
                  </span>
                  <span>
                    {t('editor.aiPanel.readinessImpact', {
                      defaultValue: 'Impact',
                    })}
                    : {audiobookReadiness.metrics.impactCueCount}
                  </span>
                  <span>
                    {t('editor.aiPanel.readinessAmbience', {
                      defaultValue: 'Amb',
                    })}
                    : {audiobookReadiness.metrics.ambienceCueCount}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-1.5 text-[11px] opacity-90">
                  <span>
                    {t('editor.aiPanel.readinessFinishing', {
                      defaultValue: 'Finish',
                    })}
                    : {audiobookReadiness.metrics.finishingEnabled ? 'yes' : 'no'}
                  </span>
                  <span>
                    {t('editor.aiPanel.readinessDepth', {
                      defaultValue: 'Depth',
                    })}
                    :{' '}
                    {audiobookReadiness.metrics.depthPrepSupported
                      ? audiobookReadiness.metrics.depthPrepEnabled
                        ? 'auto'
                        : 'off'
                      : 'unsupported'}
                  </span>
                  <span>
                    {t('editor.aiPanel.readinessStudioSfx', {
                      defaultValue: 'Studio SFX',
                    })}
                    :{' '}
                    {`${audiobookReadiness.metrics.libraryMatchedCueCount}/${
                      audiobookReadiness.metrics.libraryMatchedCueCount +
                      audiobookReadiness.metrics.generatedCueCount
                    }`}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-1.5 text-[11px] opacity-90">
                  <span>
                    {t('editor.aiPanel.readinessStoryBeats', {
                      defaultValue: 'Beats',
                    })}
                    :{' '}
                    {audiobookReadiness.metrics.storyBeatCount > 0
                      ? `${audiobookReadiness.metrics.coveredStoryBeatCount}/${audiobookReadiness.metrics.storyBeatCount}`
                      : '-'}
                  </span>
                  <span>
                    {t('editor.aiPanel.readinessSfxVariety', {
                      defaultValue: 'Var',
                    })}
                    : {audiobookReadiness.metrics.uniqueCueLabels}
                  </span>
                  <span>
                    {t('editor.aiPanel.readinessImpactVariety', {
                      defaultValue: 'Hit Var',
                    })}
                    : {audiobookReadiness.metrics.uniqueImpactCueLabels}
                  </span>
                </div>
                {audiobookReadiness.issues.length > 0 && (
                  <div className="space-y-1 pt-0.5">
                    {audiobookReadiness.issues.slice(0, 3).map((readinessIssue) => (
                      <p key={readinessIssue.id} className="leading-snug opacity-90">
                        {readinessIssue.message}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}

            {audiobookTimelineAudit && (
              <div
                className={cn(
                  'space-y-2 rounded-lg border p-3 text-xs',
                  getCinematicReadinessClasses(audiobookTimelineAudit.grade),
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium">
                    {t('editor.aiPanel.timelineAudit', {
                      defaultValue: 'Timeline audit',
                    })}
                  </span>
                  <span className="font-mono text-[11px]">
                    {audiobookTimelineAudit.score.toFixed(1)}/10
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-background/45">
                  <div
                    className={cn(
                      'h-full rounded-full transition-[width] duration-300',
                      getCinematicReadinessBarClass(audiobookTimelineAudit.grade),
                    )}
                    style={{
                      width: `${Math.round(audiobookTimelineAudit.score * 10)}%`,
                    }}
                  />
                </div>
                <p className="leading-relaxed opacity-90">{audiobookTimelineAudit.summary}</p>
                <div className="grid grid-cols-3 gap-1.5 text-[11px] opacity-90">
                  <span>
                    {t('editor.aiPanel.timelineAuditMotion', {
                      defaultValue: 'Motion',
                    })}
                    :{' '}
                    {`${audiobookTimelineAudit.metrics.multiAxisImageCount}/${audiobookTimelineAudit.metrics.imageCount}`}
                  </span>
                  <span>
                    {t('editor.aiPanel.timelineAuditStaged', {
                      defaultValue: 'Staged',
                    })}
                    :{' '}
                    {`${audiobookTimelineAudit.metrics.stagedCameraImageCount}/${audiobookTimelineAudit.metrics.imageCount}`}
                  </span>
                  <span>
                    {t('editor.aiPanel.timelineAuditSfx', {
                      defaultValue: 'SFX',
                    })}
                    : {audiobookTimelineAudit.metrics.sfxCount}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-1.5 text-[11px] opacity-90">
                  <span>
                    {t('editor.aiPanel.timelineAuditCutFx', {
                      defaultValue: 'Cut FX',
                    })}
                    :{' '}
                    {`${audiobookTimelineAudit.metrics.directedTransitionCutCount}/${audiobookTimelineAudit.metrics.imageCutCount}`}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-1.5 text-[11px] opacity-90">
                  <span>
                    {t('editor.aiPanel.timelineAuditDucking', {
                      defaultValue: 'Ducking',
                    })}
                    :{' '}
                    {`${audiobookTimelineAudit.metrics.duckedMusicBedCount}/${audiobookTimelineAudit.metrics.musicBedCount}`}
                  </span>
                  <span>
                    {t('editor.aiPanel.timelineAuditMix', {
                      defaultValue: 'Mix',
                    })}
                    : {audiobookTimelineAudit.metrics.stemMixScore.toFixed(1)}
                  </span>
                  <span>
                    {t('editor.aiPanel.timelineAuditMusicLevel', {
                      defaultValue: 'Music',
                    })}
                    : {formatDb(audiobookTimelineAudit.metrics.musicUnderNarrationDb)}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-1.5 text-[11px] opacity-90">
                  <span>
                    {t('editor.aiPanel.timelineAuditSfxLevel', {
                      defaultValue: 'FG SFX',
                    })}
                    : {formatDb(audiobookTimelineAudit.metrics.foregroundSfxToNarrationDb)}
                  </span>
                  <span>
                    {t('editor.aiPanel.timelineAuditDepth', {
                      defaultValue: 'Depth',
                    })}
                    : {audiobookTimelineAudit.metrics.depthReadinessScore.toFixed(1)}
                  </span>
                  <span>
                    {t('editor.aiPanel.timelineAuditLayers', {
                      defaultValue: 'Layers',
                    })}
                    : {audiobookTimelineAudit.metrics.depthLayerGroupCount}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-1.5 text-[11px] opacity-90">
                  <span>
                    {t('editor.aiPanel.timelineAuditPrep', {
                      defaultValue: 'Prep',
                    })}
                    : {audiobookTimelineAudit.metrics.depthPreparedImagePct.toFixed(0)}%
                  </span>
                  <span>
                    {t('editor.aiPanel.timelineAuditDepthQuality', {
                      defaultValue: 'Depth Q',
                    })}
                    :{' '}
                    {audiobookTimelineAudit.metrics.averageDepthQuality == null
                      ? '-'
                      : `${Math.round(audiobookTimelineAudit.metrics.averageDepthQuality * 100)}%`}
                  </span>
                  <span>
                    {t('editor.aiPanel.timelineAuditRhythm', {
                      defaultValue: 'Rhythm',
                    })}
                    : {audiobookTimelineAudit.metrics.shotRhythmScore.toFixed(1)}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-1.5 text-[11px] opacity-90">
                  <span>
                    {t('editor.aiPanel.timelineAuditStoryBeats', {
                      defaultValue: 'Beats',
                    })}
                    :{' '}
                    {audiobookTimelineAudit.metrics.storyBeatCount > 0
                      ? `${audiobookTimelineAudit.metrics.storyBeatSfxCoveredCount}/${audiobookTimelineAudit.metrics.storyBeatCount}`
                      : '-'}
                  </span>
                  <span>
                    {t('editor.aiPanel.timelineAuditImageStory', {
                      defaultValue: 'Imgs',
                    })}
                    :{' '}
                    {audiobookTimelineAudit.metrics.imageStoryMeasurableCount > 0
                      ? `${audiobookTimelineAudit.metrics.imageStoryMatchedCount}/${audiobookTimelineAudit.metrics.imageStoryMeasurableCount}`
                      : '-'}
                  </span>
                  <span>
                    {t('editor.aiPanel.timelineAuditReferenceReady', {
                      defaultValue: 'Ready',
                    })}
                    : {audiobookTimelineAudit.metrics.referenceReadinessScore.toFixed(1)}
                  </span>
                </div>
                {audiobookTimelineAudit.issues.length > 0 && (
                  <div className="space-y-1 pt-0.5">
                    {audiobookTimelineAudit.issues.slice(0, 3).map((auditIssue) => (
                      <p key={auditIssue.id} className="leading-snug opacity-90">
                        {auditIssue.message}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center justify-end gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  void handleAudiobookAnalyze()
                }}
                disabled={isAudiobookGenerating || !audiobookNarrationItem}
                className="h-7 shrink-0 gap-1.5"
              >
                <ListPlus className="h-3.5 w-3.5" />
                {t('editor.aiPanel.audiobookAnalyze', {
                  defaultValue: 'Plan edit',
                })}
              </Button>
              {isAudiobookGenerating && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleAudiobookCancel}
                  className="h-7 shrink-0 gap-1.5 text-muted-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                  {t('common.cancel')}
                </Button>
              )}
              <Button
                size="sm"
                onClick={() => {
                  void handleAudiobookGenerate()
                }}
                disabled={
                  isAudiobookGenerating ||
                  !audiobookNarrationItem ||
                  !currentProjectId ||
                  !isMusicSupported
                }
                className="h-7 shrink-0 gap-1.5"
              >
                {isAudiobookGenerating ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <WandSparkles className="h-3.5 w-3.5" />
                )}
                {isAudiobookGenerating
                  ? t('editor.tts.generating')
                  : t('editor.aiPanel.audiobookGenerate', {
                      defaultValue: 'Build cinematic edit',
                    })}
              </Button>
            </div>

            {audiobookProgress && (
              <div className="space-y-2 rounded-lg border border-border bg-secondary/20 p-3">
                <p className="text-xs text-muted-foreground">{audiobookProgress}</p>
                {audiobookProgressPct != null && (
                  <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                    <div
                      className="h-full rounded-full bg-primary transition-[width] duration-300 ease-linear"
                      style={{
                        width: `${Math.round(audiobookProgressPct * 100)}%`,
                      }}
                    />
                  </div>
                )}
              </div>
            )}

            {audiobookError && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                {audiobookError}
              </div>
            )}

            {audiobookPlan.length > 0 && (
              <div className="space-y-2">
                <span className="text-xs font-medium text-muted-foreground">
                  {t('editor.aiPanel.audiobookPlan', {
                    defaultValue: 'Cue plan',
                  })}
                </span>
                <div className="space-y-1.5">
                  {audiobookPlan.slice(0, 6).map((cue) => (
                    <div
                      key={cue.id}
                      className="rounded-md border border-border bg-secondary/20 px-2 py-1.5 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-medium">{cue.label}</span>
                        <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                          <span className="rounded border border-border bg-background/60 px-1 py-0 font-medium capitalize">
                            {cue.role}
                          </span>
                          <span className="font-mono">{formatTime(cue.startSeconds)}</span>
                        </span>
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">
                        {cue.sourceText || cue.reason}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {studioAudioCredits.length > 0 && (
              <div className="space-y-2 rounded-lg border border-border bg-secondary/20 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium">
                    {t('editor.aiPanel.studioAudioCredits', {
                      defaultValue: 'Audio credits',
                    })}
                  </span>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {studioAudioCredits.length}
                  </span>
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={handleApproveSafeStudioAudio}
                    className="h-7 flex-1 gap-1.5"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Approve safe
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleReduceStudioAudio}
                    className="h-7 shrink-0"
                  >
                    -3 dB
                  </Button>
                </div>
                <div className="space-y-1.5">
                  {studioAudioItems.slice(0, 6).map((item) => {
                    const source = item.studioAudioSource!
                    return (
                      <div
                        key={item.id}
                        className="space-y-1 rounded border border-border bg-background/35 px-2 py-1.5 text-[11px]"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate font-medium">{source.title}</span>
                          <span className="shrink-0 font-mono text-muted-foreground">
                            {formatTime(item.from / Math.max(1, timelineFps))}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2 text-muted-foreground">
                          <span className="truncate">
                            {source.creator} / {source.licenseCode.toUpperCase()}
                          </span>
                          <a
                            href={source.sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="shrink-0 text-primary hover:underline"
                          >
                            Source
                          </a>
                        </div>
                        <p className="line-clamp-2 text-muted-foreground">{source.reason}</p>
                      </div>
                    )
                  })}
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      void handleCopyStudioAudioCredits()
                    }}
                    className="h-7 flex-1 gap-1.5"
                  >
                    <ClipboardCopy className="h-3.5 w-3.5" />
                    Copy YouTube credits
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() =>
                      downloadStudioAudioCredits(
                        studioAudioCredits,
                        currentProject?.name ?? 'freecut-project',
                      )
                    }
                    className="h-7 w-7 shrink-0"
                    aria-label="Download audio credits"
                  >
                    <FileDown className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )}
          </CollapsibleContent>
        </Collapsible>

        <Collapsible open={musicSectionOpen} onOpenChange={setMusicSectionOpen}>
          <div className="-mx-3 bg-secondary/50 px-3 py-2">
            <div className="flex items-center gap-2">
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="flex flex-1 items-center justify-between gap-2 text-left"
                  aria-label={
                    musicSectionOpen
                      ? t('editor.aiPanel.collapseMusicGeneration')
                      : t('editor.aiPanel.expandMusicGeneration')
                  }
                >
                  <h2 className="text-sm font-medium">{t('editor.aiPanel.musicGeneration')}</h2>
                  <ChevronDown
                    className={cn(
                      'h-4 w-4 text-muted-foreground transition-transform',
                      musicSectionOpen && 'rotate-180',
                    )}
                  />
                </button>
              </CollapsibleTrigger>
              <Popover open={musicInfoOpen} onOpenChange={setMusicInfoOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="rounded-full p-0.5 text-muted-foreground hover:text-foreground"
                    aria-label={t('editor.aiPanel.musicGenerationInfo')}
                    onMouseEnter={() => setMusicInfoOpen(true)}
                    onMouseLeave={() => setMusicInfoOpen(false)}
                  >
                    <Info className="h-3.5 w-3.5" />
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  side="bottom"
                  align="start"
                  className="w-72 space-y-2 p-3 text-xs"
                  onMouseEnter={() => setMusicInfoOpen(true)}
                  onMouseLeave={() => setMusicInfoOpen(false)}
                  onOpenAutoFocus={(e) => e.preventDefault()}
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                      WebGPU
                    </span>
                    <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                      Local
                    </span>
                  </div>
                  <p className="leading-relaxed text-muted-foreground">
                    {t('editor.aiPanel.musicgenDescription')}
                  </p>
                  <table className="w-full text-[11px]">
                    <tbody>
                      {MUSICGEN_MODEL_OPTIONS.map((option) => (
                        <tr key={option.value} className="border-t border-border/50">
                          <td className="py-1 pr-2 font-medium text-foreground">{option.label}</td>
                          <td className="py-1 text-right text-muted-foreground">
                            {option.downloadLabel}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="leading-relaxed text-muted-foreground">
                    {t('editor.aiPanel.musicgenPromptHint')}
                  </p>
                </PopoverContent>
              </Popover>
            </div>
          </div>

          <CollapsibleContent className="space-y-4 pt-3">
            {!isMusicSupported && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-100">
                {t('editor.aiPanel.musicgenUnsupported')}
              </div>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="ai-music-prompt">{t('editor.aiPanel.prompt')}</Label>
                <Select
                  value=""
                  onValueChange={(value) => setMusicPrompt(value)}
                  disabled={isMusicGenerating}
                >
                  <SelectTrigger className="h-6 w-auto gap-1 border-none bg-transparent px-1.5 text-[11px] text-muted-foreground shadow-none hover:text-foreground">
                    <SelectValue placeholder={t('editor.aiPanel.presets')} />
                  </SelectTrigger>
                  <SelectContent align="end">
                    {MUSIC_PROMPT_PRESETS.map((preset) => (
                      <SelectItem
                        key={preset.labelKey}
                        value={t(preset.promptKey)}
                        className="text-xs"
                      >
                        {t(preset.labelKey)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Textarea
                id="ai-music-prompt"
                value={musicPrompt}
                onChange={(event) => setMusicPrompt(event.target.value)}
                placeholder={t('editor.aiPanel.musicPromptPlaceholder')}
                className="min-h-24 resize-y bg-secondary/30 text-sm"
                disabled={isMusicGenerating}
              />
            </div>

            <SliderInput
              label={t('editor.aiPanel.length')}
              value={musicDuration}
              onChange={(value) => setMusicDuration(Math.round(value))}
              min={currentMusicModel.minDurationSeconds}
              max={currentMusicModel.maxDurationSeconds}
              step={1}
              unit="s"
              disabled={isMusicGenerating}
            />

            <div className="flex items-center justify-end gap-2">
              {isMusicGenerating && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleMusicCancel}
                  className="h-7 shrink-0 gap-1.5 text-muted-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                  {t('common.cancel')}
                </Button>
              )}
              <Button
                size="sm"
                onClick={() => {
                  void handleMusicGenerate()
                }}
                disabled={
                  isMusicGenerating || !trimmedMusicPrompt || !currentProjectId || !isMusicSupported
                }
                className="h-7 shrink-0 gap-1.5"
              >
                {isMusicGenerating ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <WandSparkles className="h-3.5 w-3.5" />
                )}
                {isMusicGenerating ? t('editor.tts.generating') : t('editor.aiPanel.generateMusic')}
              </Button>
            </div>

            {musicProgress && (
              <div className="space-y-2 rounded-lg border border-border bg-secondary/20 p-3">
                <p className="text-xs text-muted-foreground">{musicProgress}</p>
                {musicProgressPct != null && (
                  <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                    <div
                      className="h-full rounded-full bg-primary transition-[width] duration-300 ease-linear"
                      style={{
                        width: `${Math.round(musicProgressPct * 100)}%`,
                      }}
                    />
                  </div>
                )}
              </div>
            )}

            {musicError && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                {musicError}
              </div>
            )}

            {musicGenerations.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">
                    {t('editor.aiPanel.musicHistory', {
                      count: musicGenerations.length,
                      size: formatBytes(totalMusicBytes),
                    })}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 gap-1 px-2 text-[11px] text-muted-foreground"
                    onClick={() => clearGenerationList(setMusicGenerations)}
                    disabled={anyMusicSaving}
                  >
                    <Trash2 className="h-3 w-3" />
                    {t('editor.aiPanel.clearAll')}
                  </Button>
                </div>

                <div className="space-y-2">
                  {musicGenerations.map((generation) => (
                    <GenerationRow
                      key={generation.id}
                      generation={generation}
                      onSave={(entry) => handleSave(entry, setMusicGenerations, setMusicError)}
                      onSaveAndInsert={(entry) =>
                        handleSaveAndInsert(entry, setMusicGenerations, setMusicError)
                      }
                      onRemove={(id) => removeGenerationFromList(setMusicGenerations, id)}
                    />
                  ))}
                </div>
              </div>
            )}
          </CollapsibleContent>
        </Collapsible>
      </div>
    </div>
  )
})

// --- Row component ---

const GenerationRow = memo(function GenerationRow({
  generation: gen,
  onSave,
  onSaveAndInsert,
  onRemove,
}: {
  generation: Generation
  onSave: (gen: Generation) => Promise<void>
  onSaveAndInsert: (gen: Generation) => Promise<void>
  onRemove: (id: string) => void
}) {
  const { t } = useTranslation()
  const saved = gen.savedMediaId !== null

  return (
    <div
      className={`rounded-lg border p-3 space-y-2 ${
        saved ? 'border-emerald-500/25 bg-emerald-500/5' : 'border-border bg-secondary/20'
      }`}
    >
      {/* Meta row */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-0.5">
          <p className="line-clamp-3 text-xs leading-relaxed" title={gen.textSnippet}>
            {gen.textSnippet}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {gen.voice} / {gen.model} / {gen.duration > 0 ? `${gen.duration.toFixed(1)}s` : '-'} /{' '}
            {formatBytes(gen.byteSize)}
          </p>
        </div>
        {!gen.saving && (
          <button
            type="button"
            className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
            onClick={() => onRemove(gen.id)}
            aria-label={t('editor.aiPanel.remove')}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Audio player */}
      <MiniAudioPlayer src={gen.objectUrl} />

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-1.5">
        {saved ? (
          <span className="flex items-center gap-1 text-[11px] text-emerald-400">
            <CheckCircle2 className="h-3 w-3" />
            {t('editor.aiPanel.saved')}
          </span>
        ) : (
          <>
            <Button
              variant="secondary"
              size="sm"
              className="h-7 gap-1 px-2 text-[11px]"
              onClick={() => {
                void onSaveAndInsert(gen)
              }}
              disabled={gen.saving}
            >
              {gen.saving ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <ListPlus className="h-3 w-3" />
              )}
              {gen.saving ? t('editor.aiPanel.saving') : t('editor.aiPanel.saveAndInsert')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-[11px]"
              onClick={() => {
                void onSave(gen)
              }}
              disabled={gen.saving}
            >
              <Download className="h-3 w-3" />
              {t('editor.aiPanel.saveToLibrary')}
            </Button>
          </>
        )}
      </div>
    </div>
  )
})
