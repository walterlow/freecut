import {
  deleteTranscript,
  getTranscript,
  getTranscriptMediaIds,
  saveTranscript,
} from '@/infrastructure/storage'
import { usePlaybackStore } from '@/shared/state/playback'
import { useSelectionStore } from '@/shared/state/selection'
import { createLogger } from '@/shared/logging/logger'
import { joinTranscriptWords } from '@/shared/utils/transcript-text'
import { DEFAULT_PROJECT_HEIGHT, DEFAULT_PROJECT_WIDTH } from '@/shared/projects/defaults'
import type { MediaTranscript, MediaTranscriptModel, MediaTranscriptSegment } from '@/types/storage'
import type {
  AudioItem,
  SubtitleSegmentItem,
  TextItem,
  TimelineTranscriptCaptionCue,
  TimelineItem,
  TimelineTrack,
  VideoItem,
} from '@/types/timeline'
import type { TranscriptSegment, TranscribeOptions } from '../transcription/types'
import {
  getDefaultMediaTranscriptionAdapter,
  getMediaTranscriptionModelLabel,
} from '../transcription/registry'
import { importMediaLibraryService } from './media-library-service-loader'
import {
  buildCaptionTextItems,
  buildCaptionTrack,
  buildSubtitleSegmentForClip,
  getCaptionStyleTemplateFromPreset,
  buildCaptionTrackAbove,
  type CaptionTextItemTemplate,
  findReplaceableCaptionItemsForClip,
  findCompatibleCaptionTrackForRanges,
  isCaptionTrackCandidate,
  getCaptionTextItemTemplate,
  getCaptionRangeForClip,
} from '../utils/caption-items'
import { buildTextStylePresetTemplate } from '@/shared/typography/text-style-presets'
import { useProjectStore } from '@/features/media-library/deps/projects'
import {
  removeTimelineItemsExact,
  useCompositionNavigationStore,
  useCompositionsStore,
  useTimelineStore,
} from '@/features/media-library/deps/timeline-stores'
import { useSettingsStore } from '@/features/media-library/deps/settings-contract'
import {
  needsCustomAudioDecoder,
  resolvePreviewAudioConformUrl,
  startPreviewAudioConform,
} from '@/features/media-library/deps/composition-runtime-contract'
import {
  DEFAULT_WHISPER_MODEL,
  DEFAULT_WHISPER_QUANTIZATION,
  normalizeWhisperLanguage,
} from '@/shared/utils/whisper-settings'
import { TRANSCRIPTION_CANCELLED_MESSAGE } from '@/shared/utils/transcription-cancellation'

const logger = createLogger('MediaTranscriptionService')
const DEFAULT_MODEL: MediaTranscriptModel = DEFAULT_WHISPER_MODEL
const MAX_TRANSCRIPT_CAPTION_CHARS = 42
const MAX_TRANSCRIPT_CAPTION_WORDS = 8
const MAX_TRANSCRIPT_CAPTION_SECONDS = 2.2
const PREFERRED_TRANSCRIPT_CAPTION_SECONDS = 1.4
const MIN_TRANSCRIPT_CAPTION_WORDS = 2
// A short but audible pause is a better phrase boundary than a blanket timing offset.
const TRANSCRIPT_CAPTION_BREAK_GAP_SECONDS = 0.18
const TRANSCRIPT_CAPTION_TIMING_VERSION = 4
const SENTENCE_END_PATTERN = /[.!?。！？]$/
const DEFAULT_QUANTIZATION = DEFAULT_WHISPER_QUANTIZATION
const MAX_TRANSCRIPT_TEXT_LAYER_CHARS = 25
const TEXT_LAYERS_TRACK_NAME = 'Text Layers'

type CaptionableClip = AudioItem | VideoItem
interface InsertTranscriptAsCaptionsOptions {
  clipIds?: readonly string[]
  replaceExisting?: boolean
  selectUpdatedClips?: boolean
}

interface InsertTranscriptAsCaptionsResult {
  insertedItemCount: number
  removedItemCount: number
}

interface InsertTranscriptAsTextLayersOptions {
  clipIds?: readonly string[]
}

interface InsertTranscriptAsTextLayersResult {
  insertedItemCount: number
}

interface EnableTranscriptCaptionsResult {
  updatedClipCount: number
  removedItemCount: number
}

function definedCaptionStyleFields(
  template: Partial<CaptionTextItemTemplate> | undefined,
): Partial<CaptionTextItemTemplate> {
  if (!template) return {}
  const defined: Partial<CaptionTextItemTemplate> = {}
  for (const key of Object.keys(template) as Array<keyof CaptionTextItemTemplate>) {
    const value = template[key]
    if (value !== undefined) {
      ;(defined as Record<string, unknown>)[key] = value
    }
  }
  return defined
}

type QueueState = 'queued' | 'running'

interface TranscriptionRequestOptions {
  language?: string
  model?: MediaTranscriptModel
  quantization?: TranscribeOptions['quantization']
  onProgress?: TranscribeOptions['onProgress']
  onQueueStatusChange?: (state: QueueState) => void
}

interface QueuedTranscriptionListener {
  onProgress?: TranscribeOptions['onProgress']
  onQueueStatusChange?: (state: QueueState) => void
}

interface QueuedTranscriptionJob {
  mediaId: string
  requestKey: string
  model: MediaTranscriptModel
  quantization: NonNullable<TranscribeOptions['quantization']>
  language?: string
  listeners: QueuedTranscriptionListener[]
  promise: Promise<MediaTranscript>
  resolve: (value: MediaTranscript) => void
  reject: (reason?: unknown) => void
  state: QueueState
  stream: { collect(): Promise<TranscriptSegment[]>; cancel(message?: string): void } | null
  cancelled: boolean
  cancelMessage: string
}

function sanitizeTranscriptWord(word: NonNullable<TranscriptSegment['words']>[number]) {
  return {
    text: word.text.trim(),
    start: word.start,
    end: word.end,
    ...(typeof word.confidence === 'number' ? { confidence: word.confidence } : {}),
  }
}

function buildTranscriptSegmentFromWords(
  words: ReturnType<typeof sanitizeTranscriptWord>[],
): MediaTranscriptSegment | null {
  const validWords = words.filter((word) => word.text.length > 0 && word.end > word.start)
  const first = validWords[0]
  const last = validWords.at(-1)
  if (!first || !last) return null

  return {
    text: joinTranscriptWords(validWords.map((word) => word.text)),
    start: first.start,
    end: last.end,
    words: validWords,
  }
}

function shouldBreakTranscriptCaption(
  currentWords: ReturnType<typeof sanitizeTranscriptWord>[],
  nextWord: ReturnType<typeof sanitizeTranscriptWord>,
): boolean {
  const first = currentWords[0]
  const previous = currentWords.at(-1)
  if (!first || !previous) return false

  const nextText = joinTranscriptWords([...currentWords, nextWord].map((word) => word.text))
  const currentDuration = previous.end - first.start
  const nextDuration = nextWord.end - first.start
  const gap = nextWord.start - previous.end

  if (
    currentWords.length >= MIN_TRANSCRIPT_CAPTION_WORDS &&
    gap >= TRANSCRIPT_CAPTION_BREAK_GAP_SECONDS
  ) {
    return true
  }
  if (
    currentWords.length >= MIN_TRANSCRIPT_CAPTION_WORDS &&
    (currentWords.length >= MAX_TRANSCRIPT_CAPTION_WORDS ||
      nextText.length > MAX_TRANSCRIPT_CAPTION_CHARS ||
      nextDuration > MAX_TRANSCRIPT_CAPTION_SECONDS)
  ) {
    return true
  }
  if (
    currentDuration >= PREFERRED_TRANSCRIPT_CAPTION_SECONDS &&
    SENTENCE_END_PATTERN.test(previous.text)
  ) {
    return true
  }

  return false
}

function transcriptCaptionGroupFitsLimits(
  words: ReturnType<typeof sanitizeTranscriptWord>[],
): boolean {
  const first = words[0]
  const last = words.at(-1)
  if (!first || !last) return false

  const hasPhraseBreakingGap = words.some((word, index) => {
    const previous = words[index - 1]
    return (
      previous !== undefined && word.start - previous.end >= TRANSCRIPT_CAPTION_BREAK_GAP_SECONDS
    )
  })

  return (
    words.length <= MAX_TRANSCRIPT_CAPTION_WORDS &&
    joinTranscriptWords(words.map((word) => word.text)).length <= MAX_TRANSCRIPT_CAPTION_CHARS &&
    last.end - first.start <= MAX_TRANSCRIPT_CAPTION_SECONDS &&
    !hasPhraseBreakingGap
  )
}

function segmentTranscriptForCaptions(segments: TranscriptSegment[]): MediaTranscriptSegment[] {
  const sanitizedBySegment = segments.map((segment) =>
    (segment.words?.map(sanitizeTranscriptWord) ?? []).filter(
      (word) => word.text.length > 0 && word.end > word.start,
    ),
  )
  const words = sanitizedBySegment.flat().toSorted((left, right) => left.start - right.start)

  if (words.length === 0) {
    return segments.map((segment) => ({
      text: segment.text.trim(),
      start: segment.start,
      end: segment.end,
    }))
  }

  const captionWordGroups: (typeof words)[] = []
  let currentWords: typeof words = []

  for (const word of words) {
    if (currentWords.length > 0 && shouldBreakTranscriptCaption(currentWords, word)) {
      captionWordGroups.push(currentWords)
      currentWords = []
    }
    currentWords.push(word)
  }

  if (currentWords.length > 0) captionWordGroups.push(currentWords)

  // Avoid ending on a one-word flash. Rebalance with the preceding phrase when possible.
  const trailingGroup = captionWordGroups.at(-1)
  const previousGroup = captionWordGroups.at(-2)
  if (trailingGroup?.length === 1 && previousGroup) {
    if (previousGroup.length >= 3) {
      const shortenedPreviousGroup = previousGroup.slice(0, -1)
      const rebalancedTrailingGroup = [previousGroup.at(-1)!, ...trailingGroup]
      if (
        transcriptCaptionGroupFitsLimits(shortenedPreviousGroup) &&
        transcriptCaptionGroupFitsLimits(rebalancedTrailingGroup)
      ) {
        captionWordGroups.splice(-2, 2, shortenedPreviousGroup, rebalancedTrailingGroup)
      }
    } else if (transcriptCaptionGroupFitsLimits([...previousGroup, ...trailingGroup])) {
      previousGroup.push(...trailingGroup)
      captionWordGroups.pop()
    }
  }

  const captionSegments = captionWordGroups
    .map(buildTranscriptSegmentFromWords)
    .filter((segment): segment is MediaTranscriptSegment => segment !== null)

  segments.forEach((segment, index) => {
    if ((sanitizedBySegment[index]?.length ?? 0) > 0) return
    const text = segment.text.trim()
    if (text.length === 0) return
    captionSegments.push({ text, start: segment.start, end: segment.end })
  })

  return captionSegments.toSorted((left, right) => left.start - right.start)
}

interface TimedToken {
  text: string
  start: number
  end: number
}

function normalizeTokenText(text: string): string {
  return text.trim().replace(/\s+/g, ' ')
}

function splitLongTimedToken(token: TimedToken, maxChars: number): TimedToken[] {
  const normalized = normalizeTokenText(token.text)
  if (normalized.length <= maxChars) {
    return [{ ...token, text: normalized }]
  }

  const parts: TimedToken[] = []
  const duration = Math.max(0.001, token.end - token.start)
  let consumed = 0
  while (consumed < normalized.length) {
    const nextConsumed = Math.min(normalized.length, consumed + maxChars)
    const startRatio = consumed / normalized.length
    const endRatio = nextConsumed / normalized.length
    parts.push({
      text: normalized.slice(consumed, nextConsumed),
      start: token.start + duration * startRatio,
      end: token.start + duration * endRatio,
    })
    consumed = nextConsumed
  }

  return parts
}

function tokenizeTranscriptSegment(segment: MediaTranscriptSegment): TimedToken[] {
  const fromWords =
    segment.words
      ?.map((word) => ({
        text: normalizeTokenText(word.text),
        start: word.start,
        end: word.end,
      }))
      .filter(
        (word) => word.text.length > 0 && Number.isFinite(word.start) && word.end > word.start,
      ) ?? []
  if (fromWords.length > 0) {
    return fromWords
  }

  const words = normalizeTokenText(segment.text)
    .split(' ')
    .map((text) => text.trim())
    .filter((text) => text.length > 0)
  if (words.length === 0) {
    return []
  }

  const segmentDuration = Math.max(0.001, segment.end - segment.start)
  const perWord = segmentDuration / words.length
  return words.map((text, index) => ({
    text,
    start: segment.start + perWord * index,
    end: segment.start + perWord * (index + 1),
  }))
}

function extractTrailingWord(text: string): string {
  const pieces = text.trim().split(/\s+/)
  const last = pieces.at(-1) ?? ''
  return last.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
}

function endsWithShortWord(tokens: readonly TimedToken[]): boolean {
  const text = tokens.at(-1)?.text
  if (!text) return false
  const trailingWord = extractTrailingWord(text)
  return trailingWord.length > 0 && trailingWord.length <= 2
}

/**
 * When a group must break, prefer leaving a dangling short word ("to", "a") to
 * open the next layer rather than ending the current one with it. Returns the
 * group split into a committable remainder and the carried trailing word, or
 * null when the group has no short trailing word to carve out.
 */
function carveOutShortTrailingWord(group: TimedToken[]): {
  committed: TimedToken[]
  carried: TimedToken[]
} | null {
  const trailing = group.at(-1)
  if (group.length <= 1 || !trailing || !endsWithShortWord(group)) {
    return null
  }
  return { committed: group.slice(0, -1), carried: [trailing] }
}

/**
 * The candidate text overflowed, so the current group must break before
 * `tokenPart`. Commits the group (possibly around a carved-out short trailing
 * word) into `groups` and returns the next in-progress group.
 */
function breakGroupAtOverflow(
  groups: TimedToken[][],
  current: TimedToken[],
  tokenPart: TimedToken,
): TimedToken[] {
  const carveOut = carveOutShortTrailingWord(current)
  if (!carveOut) {
    groups.push(current)
    return [tokenPart]
  }

  groups.push(carveOut.committed)
  const carriedText = joinTranscriptWords([...carveOut.carried, tokenPart].map((item) => item.text))
  if (carriedText.length <= MAX_TRANSCRIPT_TEXT_LAYER_CHARS) {
    return [...carveOut.carried, tokenPart]
  }
  groups.push(carveOut.carried)
  return [tokenPart]
}

function groupTimedTokensForTextLayers(tokens: readonly TimedToken[]): TimedToken[][] {
  const groups: TimedToken[][] = []
  let current: TimedToken[] = []

  for (const token of tokens) {
    const normalizedTokenParts = splitLongTimedToken(token, MAX_TRANSCRIPT_TEXT_LAYER_CHARS)
    for (const tokenPart of normalizedTokenParts) {
      const candidateText = joinTranscriptWords([...current, tokenPart].map((item) => item.text))
      if (current.length > 0 && candidateText.length > MAX_TRANSCRIPT_TEXT_LAYER_CHARS) {
        current = breakGroupAtOverflow(groups, current, tokenPart)
      } else {
        current.push(tokenPart)
      }
    }
  }

  const carveOut = carveOutShortTrailingWord(current)
  if (carveOut) {
    groups.push(carveOut.committed)
    current = carveOut.carried
  }
  if (current.length > 0) {
    groups.push(current)
  }

  return groups.filter((group) => group.length > 0)
}

function segmentTranscriptForTextLayers(
  segments: readonly MediaTranscriptSegment[],
): MediaTranscriptSegment[] {
  const timedTokens = segments
    .flatMap(tokenizeTranscriptSegment)
    .filter((token) => token.text.length > 0 && token.end > token.start)
    .sort((left, right) => left.start - right.start)

  if (timedTokens.length === 0) {
    return []
  }

  return groupTimedTokensForTextLayers(timedTokens)
    .map((group) => {
      const first = group[0]
      const last = group.at(-1)
      if (!first || !last) return null
      const text = joinTranscriptWords(group.map((token) => token.text)).trim()
      if (text.length === 0 || text.length > MAX_TRANSCRIPT_TEXT_LAYER_CHARS) return null
      return {
        text,
        start: first.start,
        end: last.end,
      } satisfies MediaTranscriptSegment
    })
    .filter((segment): segment is MediaTranscriptSegment => segment !== null)
}

function buildTimelineTranscriptCaptionCues(
  mediaId: string,
  segments: readonly MediaTranscriptSegment[],
): TimelineTranscriptCaptionCue[] {
  return segmentTranscriptForCaptions([...segments]).map((segment, index) => ({
    id: `transcript-${mediaId}-${index}`,
    startSeconds: segment.start,
    endSeconds: segment.end,
    text: segment.text,
  }))
}

function buildSyncedTranscriptCaptionItem(
  item: TimelineItem,
  mediaId: string,
  transcript: MediaTranscript,
  sourceCues: TimelineTranscriptCaptionCue[],
): TimelineItem | null {
  if (
    (item.type !== 'video' && item.type !== 'audio') ||
    item.mediaId !== mediaId ||
    item.transcriptCaptions?.type !== 'transcript' ||
    item.transcriptCaptions.mediaId !== mediaId ||
    (item.transcriptCaptions.sourceTranscriptUpdatedAt === transcript.updatedAt &&
      item.transcriptCaptions.timingVersion === TRANSCRIPT_CAPTION_TIMING_VERSION)
  ) {
    return null
  }

  return {
    ...item,
    transcriptCaptions: {
      ...item.transcriptCaptions,
      cues: sourceCues,
      sourceTranscriptUpdatedAt: transcript.updatedAt,
      timingVersion: TRANSCRIPT_CAPTION_TIMING_VERSION,
      updatedAt: Date.now(),
    },
  }
}

function syncTranscriptCaptionItems(
  items: readonly TimelineItem[],
  mediaId: string,
  transcript: MediaTranscript,
  sourceCues: TimelineTranscriptCaptionCue[],
): { items: TimelineItem[]; updatedClipCount: number } {
  let updatedClipCount = 0
  const nextItems = items.map((item) => {
    const updatedItem = buildSyncedTranscriptCaptionItem(item, mediaId, transcript, sourceCues)
    if (!updatedItem) return item
    updatedClipCount += 1
    return updatedItem
  })

  return {
    items: updatedClipCount > 0 ? nextItems : [...items],
    updatedClipCount,
  }
}

class MediaTranscriptionService {
  private readonly adapter = getDefaultMediaTranscriptionAdapter()
  private readonly transcriber = this.adapter.createTranscriber({
    model: DEFAULT_MODEL,
    quantization: DEFAULT_QUANTIZATION,
  })
  private activeJob: QueuedTranscriptionJob | null = null
  private queue: QueuedTranscriptionJob[] = []
  private readonly transcriptChangeListeners = new Set<(mediaId: string) => void>()

  getTranscript = getTranscript
  getTranscriptMediaIds = getTranscriptMediaIds

  /** Notifies subscribers when a media's stored transcript is created, replaced, or deleted. */
  onTranscriptChanged(listener: (mediaId: string) => void): () => void {
    this.transcriptChangeListeners.add(listener)
    return () => {
      this.transcriptChangeListeners.delete(listener)
    }
  }

  private emitTranscriptChanged(mediaId: string): void {
    for (const listener of this.transcriptChangeListeners) {
      listener(mediaId)
    }
  }

  async deleteTranscript(mediaId: string): Promise<void> {
    await deleteTranscript(mediaId)
    this.emitTranscriptChanged(mediaId)
  }

  async transcribeMedia(
    mediaId: string,
    options: TranscriptionRequestOptions = {},
  ): Promise<MediaTranscript> {
    const settings = useSettingsStore.getState()
    const model = options.model ?? settings.defaultWhisperModel ?? DEFAULT_MODEL
    const quantization =
      options.quantization ?? settings.defaultWhisperQuantization ?? DEFAULT_QUANTIZATION
    const language = normalizeWhisperLanguage(options.language ?? settings.defaultWhisperLanguage)
    const requestKey = `${mediaId}:${model}:${quantization}:${language ?? 'auto'}`
    const listener: QueuedTranscriptionListener = {
      onProgress: options.onProgress,
      onQueueStatusChange: options.onQueueStatusChange,
    }
    const existingJob = this.findJobByKey(requestKey)

    if (existingJob) {
      this.attachListener(existingJob, listener)
      return existingJob.promise
    }

    const job = this.createJob({
      mediaId,
      requestKey,
      model,
      quantization,
      language,
      listener,
    })

    if (this.activeJob) {
      this.queue.push(job)
      this.setJobState(job, 'queued')
    } else {
      this.startJob(job)
    }

    return job.promise
  }

  cancelTranscription(mediaId: string, message = TRANSCRIPTION_CANCELLED_MESSAGE): boolean {
    let cancelled = false

    this.queue = this.queue.filter((job) => {
      if (job.mediaId !== mediaId) {
        return true
      }

      cancelled = true
      this.cancelJob(job, message)
      return false
    })

    if (this.activeJob?.mediaId === mediaId) {
      cancelled = true
      this.cancelJob(this.activeJob, message)
    }

    return cancelled
  }

  private findJobByKey(requestKey: string): QueuedTranscriptionJob | null {
    if (this.activeJob?.requestKey === requestKey) {
      return this.activeJob
    }

    return this.queue.find((job) => job.requestKey === requestKey) ?? null
  }

  private createJob({
    mediaId,
    requestKey,
    model,
    quantization,
    language,
    listener,
  }: {
    mediaId: string
    requestKey: string
    model: MediaTranscriptModel
    quantization: NonNullable<TranscribeOptions['quantization']>
    language?: string
    listener: QueuedTranscriptionListener
  }): QueuedTranscriptionJob {
    let resolve!: (value: MediaTranscript) => void
    let reject!: (reason?: unknown) => void
    const promise = new Promise<MediaTranscript>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise
      reject = rejectPromise
    })

    return {
      mediaId,
      requestKey,
      model,
      quantization,
      language,
      listeners: [listener],
      promise,
      resolve,
      reject,
      state: 'queued',
      stream: null,
      cancelled: false,
      cancelMessage: TRANSCRIPTION_CANCELLED_MESSAGE,
    }
  }

  private attachListener(job: QueuedTranscriptionJob, listener: QueuedTranscriptionListener): void {
    job.listeners.push(listener)
    listener.onQueueStatusChange?.(job.state)
  }

  private setJobState(job: QueuedTranscriptionJob, state: QueueState): void {
    job.state = state
    for (const listener of job.listeners) {
      listener.onQueueStatusChange?.(state)
    }
  }

  private cancelJob(job: QueuedTranscriptionJob, message: string): void {
    job.cancelled = true
    job.cancelMessage = message

    if (job.state === 'queued') {
      job.reject(new Error(message))
      return
    }

    job.stream?.cancel(message)
  }

  private startJob(job: QueuedTranscriptionJob): void {
    this.activeJob = job
    this.setJobState(job, 'running')

    void (async () => {
      try {
        const transcript = await this.executeTranscriptionJob(job)
        job.resolve(transcript)
      } catch (error) {
        job.reject(error)
      } finally {
        if (this.activeJob === job) {
          this.activeJob = null
        }
        this.processNextJob()
      }
    })()
  }

  private processNextJob(): void {
    if (this.activeJob) {
      return
    }

    const nextJob = this.queue.shift()
    if (nextJob) {
      this.startJob(nextJob)
    }
  }

  private throwIfCancelled(job: QueuedTranscriptionJob): void {
    if (job.cancelled) {
      throw new Error(job.cancelMessage)
    }
  }

  private async executeTranscriptionJob(job: QueuedTranscriptionJob): Promise<MediaTranscript> {
    const mediaId = job.mediaId
    const { mediaLibraryService } = await importMediaLibraryService()
    const media = await mediaLibraryService.getMedia(mediaId)
    if (!media) {
      throw new Error(`Media not found: ${mediaId}`)
    }
    this.throwIfCancelled(job)

    if (!media.mimeType.startsWith('audio/') && !media.mimeType.startsWith('video/')) {
      throw new Error('Only audio and video files can be transcribed')
    }

    const sourceBlob = await mediaLibraryService.getMediaFile(mediaId)
    if (!sourceBlob) {
      throw new Error(`Could not load media file: ${media.fileName}`)
    }
    this.throwIfCancelled(job)

    const transcriptionBlob = await this.resolveTranscriptionBlob(media, sourceBlob)
    this.throwIfCancelled(job)

    const file =
      transcriptionBlob instanceof File
        ? transcriptionBlob
        : new File([transcriptionBlob], media.fileName, {
            type: transcriptionBlob.type || media.mimeType,
            lastModified: media.fileLastModified ?? Date.now(),
          })

    const stream = this.transcriber.transcribe(file, {
      model: job.model,
      language: job.language,
      quantization: job.quantization,
      onProgress: (progress) => {
        for (const listener of job.listeners) {
          listener.onProgress?.(progress)
        }
      },
    })
    job.stream = stream
    const segments = await stream.collect()
    this.throwIfCancelled(job)

    const transcript: MediaTranscript = {
      id: mediaId,
      mediaId,
      model: job.model,
      language: job.language,
      quantization: job.quantization,
      text: joinTranscriptWords(segments.map((segment) => segment.text)),
      segments: segmentTranscriptForCaptions(segments),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    await saveTranscript(transcript)
    this.syncExistingTranscriptCaptions(mediaId, transcript)
    this.emitTranscriptChanged(mediaId)
    logger.info('Saved transcript', {
      mediaId,
      segments: transcript.segments.length,
      model: getMediaTranscriptionModelLabel(transcript.model),
    })
    return transcript
  }

  /**
   * Refresh transcript-derived cues already attached to timeline clips. Caption
   * visibility and styling remain clip-owned and are intentionally preserved.
   */
  syncExistingTranscriptCaptions(mediaId: string, transcript: MediaTranscript): number {
    const timeline = useTimelineStore.getState()
    const sourceCues = buildTimelineTranscriptCaptionCues(mediaId, transcript.segments)
    let updatedClipCount = 0

    for (const item of timeline.items ?? []) {
      const updatedItem = buildSyncedTranscriptCaptionItem(item, mediaId, transcript, sourceCues)
      if (!updatedItem) continue
      timeline.updateItem?.(item.id, {
        transcriptCaptions: updatedItem.transcriptCaptions,
      } as Partial<TimelineItem>)
      updatedClipCount += 1
    }

    // Compound contents are stored outside the active timeline. Refresh every
    // registered composition so deeply nested and reused instances cannot keep
    // an older transcript snapshot.
    const compositionsState = useCompositionsStore.getState()
    for (const composition of compositionsState.compositions) {
      const synced = syncTranscriptCaptionItems(composition.items, mediaId, transcript, sourceCues)
      if (synced.updatedClipCount === 0) continue
      compositionsState.updateComposition(composition.id, { items: synced.items })
      updatedClipCount += synced.updatedClipCount
    }

    // While drilling through compounds, parent timelines are held in navigation
    // stashes and can later overwrite the composition registry. Keep those
    // snapshots in sync too.
    const navigationState = useCompositionNavigationStore.getState()
    let updatedStashedClipCount = 0
    const syncStash = <T extends { items: TimelineItem[] }>(stash: T): T => {
      const synced = syncTranscriptCaptionItems(stash.items, mediaId, transcript, sourceCues)
      updatedStashedClipCount += synced.updatedClipCount
      return synced.updatedClipCount > 0 ? { ...stash, items: synced.items } : stash
    }
    const nextStashStack = navigationState.stashStack.map(syncStash)
    const nextMainHolder = navigationState.mainHolder ? syncStash(navigationState.mainHolder) : null
    if (updatedStashedClipCount > 0) {
      useCompositionNavigationStore.setState({
        stashStack: nextStashStack,
        mainHolder: nextMainHolder,
      })
      updatedClipCount += updatedStashedClipCount
    }

    return updatedClipCount
  }

  private async resolveTranscriptionBlob(
    media: { id: string; fileName: string; mimeType: string; codec: string; audioCodec?: string },
    sourceBlob: Blob,
  ): Promise<Blob> {
    const transcriptionCodec = media.mimeType.startsWith('audio/')
      ? media.codec
      : (media.audioCodec ?? media.codec)

    if (!needsCustomAudioDecoder(transcriptionCodec)) {
      return sourceBlob
    }

    let conformedUrl = await resolvePreviewAudioConformUrl(media.id)
    if (!conformedUrl) {
      await startPreviewAudioConform(media.id, sourceBlob)
      conformedUrl = await resolvePreviewAudioConformUrl(media.id)
    }

    if (!conformedUrl) {
      throw new Error(`Failed to prepare ${transcriptionCodec || 'custom'} audio for transcription`)
    }

    const response = await fetch(conformedUrl)
    if (!response.ok) {
      throw new Error(`Failed to load conformed audio for transcription (${response.status})`)
    }

    return await response.blob()
  }

  async insertTranscriptAsCaptions(
    mediaId: string,
    options: InsertTranscriptAsCaptionsOptions = {},
  ): Promise<InsertTranscriptAsCaptionsResult> {
    const transcript = await getTranscript(mediaId)
    if (!transcript) {
      throw new Error('No transcript found for this media item')
    }

    const timeline = useTimelineStore.getState()
    const project = useProjectStore.getState().currentProject
    const targetClips = this.resolveCaptionTargetClips(mediaId, options.clipIds)
    if (targetClips.length === 0) {
      throw new Error('Select a clip for this media, or place one on the timeline first')
    }

    const canvasWidth = project?.metadata.width ?? DEFAULT_PROJECT_WIDTH
    const canvasHeight = project?.metadata.height ?? DEFAULT_PROJECT_HEIGHT
    const defaultCaptionTemplate = getCaptionStyleTemplateFromPreset(
      useSettingsStore.getState().defaultCaptionStylePresetId,
      canvasWidth,
      canvasHeight,
    )
    const newTracks: TimelineTrack[] = [...timeline.tracks]
    const generatedCaptionIdsToRemove = options.replaceExisting
      ? new Set(
          targetClips.flatMap((clip) =>
            findReplaceableCaptionItemsForClip(timeline.items, clip, 'transcript').map(
              (item) => item.id,
            ),
          ),
        )
      : new Set<string>()
    const plannedItems = timeline.items.filter((item) => !generatedCaptionIdsToRemove.has(item.id))
    const insertedItems: SubtitleSegmentItem[] = []

    for (const clip of targetClips) {
      const clipRange = getCaptionRangeForClip(clip, transcript.segments, timeline.fps)
      if (!clipRange) {
        continue
      }

      const existingGeneratedCaptions = options.replaceExisting
        ? findReplaceableCaptionItemsForClip(timeline.items, clip, 'transcript')
        : []
      const preferredTrackId = this.resolvePreferredCaptionTrackId(
        newTracks,
        plannedItems,
        existingGeneratedCaptions,
        clipRange,
      )

      let targetTrack = preferredTrackId
        ? (newTracks.find((track) => track.id === preferredTrackId) ?? null)
        : findCompatibleCaptionTrackForRanges(newTracks, plannedItems, [
            { startFrame: clipRange.startFrame, endFrame: clipRange.endFrame },
          ])

      if (!targetTrack) {
        const clipTrack = newTracks.find((track) => track.id === clip.trackId)
        targetTrack = clipTrack
          ? buildCaptionTrackAbove(newTracks, clipTrack.order)
          : buildCaptionTrackAbove(newTracks, 0)
        newTracks.push(targetTrack)
        newTracks.sort((a, b) => a.order - b.order)
      }

      const clipCaptionItem = buildSubtitleSegmentForClip({
        trackId: targetTrack.id,
        cues: buildTimelineTranscriptCaptionCues(clip.id, transcript.segments),
        clip,
        timelineFps: timeline.fps,
        canvasWidth,
        canvasHeight,
        label: 'Transcript',
        source: {
          type: 'transcript',
          mediaId,
          clipId: clip.id,
        },
        styleTemplate: existingGeneratedCaptions[0]
          ? getCaptionTextItemTemplate(existingGeneratedCaptions[0])
          : defaultCaptionTemplate,
      })

      if (!clipCaptionItem) {
        continue
      }

      insertedItems.push(clipCaptionItem)
      plannedItems.push(clipCaptionItem)
    }

    if (insertedItems.length === 0 && generatedCaptionIdsToRemove.size === 0) {
      throw new Error('Transcript does not overlap the selected clip source range')
    }

    const tracksChanged =
      newTracks.length !== timeline.tracks.length ||
      newTracks.some((track, index) => track.id !== timeline.tracks[index]?.id)
    if (tracksChanged) {
      timeline.setTracks(newTracks)
    }

    if (generatedCaptionIdsToRemove.size > 0) {
      removeTimelineItemsExact([...generatedCaptionIdsToRemove])
    }

    if (insertedItems.length > 0) {
      timeline.addItems(insertedItems)
      useSelectionStore.getState().selectItems(insertedItems.map((item) => item.id))
    }

    return {
      insertedItemCount: insertedItems.length,
      removedItemCount: generatedCaptionIdsToRemove.size,
    }
  }

  async insertTranscriptAsTextLayers(
    options: InsertTranscriptAsTextLayersOptions = {},
  ): Promise<InsertTranscriptAsTextLayersResult> {
    const timeline = useTimelineStore.getState()
    const project = useProjectStore.getState().currentProject
    const canvasWidth = project?.metadata.width ?? DEFAULT_PROJECT_WIDTH
    const canvasHeight = project?.metadata.height ?? DEFAULT_PROJECT_HEIGHT
    const targetClips = this.dedupeTextLayerTargetClips(
      this.resolveCaptionTargetClips('', options.clipIds),
    )

    if (targetClips.length === 0) {
      return { insertedItemCount: 0 }
    }

    const circeTemplate = buildTextStylePresetTemplate(
      'circe-bold',
      {
        width: canvasWidth,
        height: canvasHeight,
        fps: timeline.fps,
      },
      1,
    )
    const {
      text: _templateText,
      label: _templateLabel,
      textSpans: _templateSpans,
      textStylePresetId: _templatePresetId,
      textStyleScale: _templateScale,
      ...circeStyleTemplate
    } = circeTemplate

    const tracks = [...timeline.tracks]
    const { track: textLayersTrack, isNew: isNewTextLayersTrack } =
      this.resolveTextLayersTrack(tracks)

    const insertedItems = await this.buildTextLayerItemsForClips({
      targetClips,
      trackId: textLayersTrack.id,
      timelineFps: timeline.fps,
      canvasWidth,
      canvasHeight,
      styleTemplate: circeStyleTemplate as CaptionTextItemTemplate,
    })

    if (insertedItems.length > 0 && isNewTextLayersTrack) {
      tracks.sort((a, b) => a.order - b.order)
      timeline.setTracks(tracks)
    }

    if (insertedItems.length > 0) {
      timeline.addItems(insertedItems)
      useSelectionStore.getState().selectItems(insertedItems.map((item) => item.id))
    }

    return {
      insertedItemCount: insertedItems.length,
    }
  }

  async enableTranscriptCaptions(
    mediaId: string,
    options: InsertTranscriptAsCaptionsOptions = {},
  ): Promise<EnableTranscriptCaptionsResult> {
    const transcript = await getTranscript(mediaId)
    if (!transcript) {
      throw new Error('No transcript found for this media item')
    }

    const timeline = useTimelineStore.getState()
    const project = useProjectStore.getState().currentProject
    const targetClips = this.resolveCaptionTargetClips(mediaId, options.clipIds)
    if (targetClips.length === 0) {
      throw new Error('Select a clip for this media, or place one on the timeline first')
    }

    const canvasWidth = project?.metadata.width ?? DEFAULT_PROJECT_WIDTH
    const canvasHeight = project?.metadata.height ?? DEFAULT_PROJECT_HEIGHT
    const defaultCaptionTemplate = getCaptionStyleTemplateFromPreset(
      useSettingsStore.getState().defaultCaptionStylePresetId,
      canvasWidth,
      canvasHeight,
    )
    const sourceCues = buildTimelineTranscriptCaptionCues(mediaId, transcript.segments)
    const generatedCaptionIdsToRemove = options.replaceExisting
      ? new Set(
          targetClips.flatMap((clip) =>
            findReplaceableCaptionItemsForClip(timeline.items, clip, 'transcript').map(
              (item) => item.id,
            ),
          ),
        )
      : new Set<string>()

    let updatedClipCount = 0
    for (const clip of targetClips) {
      const clipRange = getCaptionRangeForClip(clip, transcript.segments, timeline.fps)
      if (!clipRange) continue

      const existingGeneratedCaptions = options.replaceExisting
        ? findReplaceableCaptionItemsForClip(timeline.items, clip, 'transcript')
        : []
      const previousVirtualStyle = clip.transcriptCaptions?.style
      const existingStyle =
        existingGeneratedCaptions[0] !== undefined
          ? getCaptionTextItemTemplate(existingGeneratedCaptions[0])
          : undefined
      const mergedStyleTemplate = {
        ...definedCaptionStyleFields(defaultCaptionTemplate),
        ...definedCaptionStyleFields(previousVirtualStyle),
        ...definedCaptionStyleFields(existingStyle),
      } as CaptionTextItemTemplate
      const styleTemplate =
        Object.keys(mergedStyleTemplate).length > 0 ? mergedStyleTemplate : undefined

      timeline.updateItem(clip.id, {
        transcriptCaptions: {
          type: 'transcript',
          mediaId,
          enabled: true,
          updatedAt: Date.now(),
          sourceTranscriptUpdatedAt: transcript.updatedAt,
          timingVersion: TRANSCRIPT_CAPTION_TIMING_VERSION,
          cues: sourceCues,
          ...(styleTemplate ? { style: styleTemplate } : {}),
        },
      } as Partial<TimelineItem>)
      updatedClipCount += 1
    }

    if (updatedClipCount === 0 && generatedCaptionIdsToRemove.size === 0) {
      throw new Error('Transcript does not overlap the selected clip source range')
    }

    if (generatedCaptionIdsToRemove.size > 0) {
      removeTimelineItemsExact([...generatedCaptionIdsToRemove])
    }

    if (updatedClipCount > 0 && options.selectUpdatedClips !== false) {
      useSelectionStore.getState().selectItems(targetClips.map((clip) => clip.id))
    }

    return {
      updatedClipCount,
      removedItemCount: generatedCaptionIdsToRemove.size,
    }
  }

  private resolveCaptionTargetClips(
    mediaId: string,
    clipIds?: readonly string[],
  ): CaptionableClip[] {
    const timeline = useTimelineStore.getState()
    const selection = useSelectionStore.getState()
    const playheadFrame = usePlaybackStore.getState().currentFrame

    const matchingClips = timeline.items
      .filter((item): item is CaptionableClip => {
        if (item.type !== 'video' && item.type !== 'audio') {
          return false
        }
        if (mediaId.length === 0) {
          return true
        }
        return item.mediaId === mediaId
      })
      .sort((a, b) => a.from - b.from)

    if (matchingClips.length === 0) {
      return []
    }

    if (clipIds && clipIds.length > 0) {
      const requestedClipIds = new Set(clipIds)
      return matchingClips.filter((clip) => requestedClipIds.has(clip.id))
    }

    const selectedClips = selection.selectedItemIds
      .map((id) => matchingClips.find((clip) => clip.id === id))
      .filter((clip): clip is CaptionableClip => clip !== undefined)

    if (selectedClips.length > 0) {
      return selectedClips
    }

    if (matchingClips.length === 1) {
      return matchingClips
    }

    const clipAtPlayhead = matchingClips.find(
      (clip) => playheadFrame >= clip.from && playheadFrame < clip.from + clip.durationInFrames,
    )
    if (clipAtPlayhead) {
      return [clipAtPlayhead]
    }

    return []
  }

  private async buildTextLayerItemsForClips({
    targetClips,
    trackId,
    timelineFps,
    canvasWidth,
    canvasHeight,
    styleTemplate,
  }: {
    targetClips: Array<CaptionableClip & { mediaId: string }>
    trackId: string
    timelineFps: number
    canvasWidth: number
    canvasHeight: number
    styleTemplate: CaptionTextItemTemplate
  }): Promise<TextItem[]> {
    const transcriptByMediaId = new Map<string, MediaTranscript>()
    const insertedItems: TextItem[] = []

    for (const clip of targetClips) {
      const transcript = await this.loadTranscriptCached(transcriptByMediaId, clip.mediaId)
      if (!transcript) {
        continue
      }

      const layeredSegments = segmentTranscriptForTextLayers(transcript.segments)
      if (layeredSegments.length === 0) {
        continue
      }

      const clipTextItems = buildCaptionTextItems({
        mediaId: clip.mediaId,
        trackId,
        segments: layeredSegments,
        clip,
        timelineFps,
        canvasWidth,
        canvasHeight,
        styleTemplate,
        sourceType: 'transcript',
      }).map((item) => ({
        ...item,
        label: item.text,
        textStylePresetId: 'circe-bold' as const,
        textStyleScale: 1,
      }))

      insertedItems.push(...clipTextItems)
    }

    return insertedItems
  }

  private async loadTranscriptCached(
    cache: Map<string, MediaTranscript>,
    mediaId: string,
  ): Promise<MediaTranscript | undefined> {
    const cached = cache.get(mediaId)
    if (cached) {
      return cached
    }
    const transcript = await getTranscript(mediaId)
    if (transcript) {
      cache.set(mediaId, transcript)
    }
    return transcript
  }

  /**
   * A video dropped on the timeline spawns a linked audio companion sharing the
   * same mediaId and timeline range. Processing both would emit identical text
   * layers twice, so keep one clip per media + overlapping range — preferring
   * the audio item, since the transcript is of the audio. Lone video clips (no
   * audio companion) and distinct placements of the same media are still
   * processed.
   */
  private dedupeTextLayerTargetClips(
    clips: readonly CaptionableClip[],
  ): Array<CaptionableClip & { mediaId: string }> {
    const candidates = clips
      .filter(
        (clip): clip is CaptionableClip & { mediaId: string } =>
          clip.mediaId !== undefined && clip.mediaId !== '',
      )
      .sort((a, b) => Number(a.type !== 'audio') - Number(b.type !== 'audio'))
    const acceptedRangesByMedia = new Map<string, Array<{ from: number; to: number }>>()
    const deduped: Array<CaptionableClip & { mediaId: string }> = []

    for (const clip of candidates) {
      const from = clip.from
      const to = clip.from + clip.durationInFrames
      const accepted = acceptedRangesByMedia.get(clip.mediaId) ?? []
      if (accepted.some((other) => other.from < to && from < other.to)) continue
      accepted.push({ from, to })
      acceptedRangesByMedia.set(clip.mediaId, accepted)
      deduped.push(clip)
    }

    return deduped.sort((a, b) => a.from - b.from)
  }

  /**
   * The "Text Layers" track is canonical and sits on top of every other track
   * (lower `order` = visually higher). Reuse it when the topmost track is that
   * track; otherwise create it there. A same-named track buried lower in the
   * stack does not qualify — its layers would render behind video.
   */
  private resolveTextLayersTrack(tracks: TimelineTrack[]): {
    track: TimelineTrack
    isNew: boolean
  } {
    const topTrack = tracks.reduce<TimelineTrack | null>(
      (top, track) => (top === null || track.order < top.order ? track : top),
      null,
    )
    if (topTrack?.name === TEXT_LAYERS_TRACK_NAME) {
      return { track: topTrack, isNew: false }
    }

    const track = {
      ...buildCaptionTrack(tracks),
      id: `track-text-layers-${crypto.randomUUID()}`,
      name: TEXT_LAYERS_TRACK_NAME,
      order: (topTrack?.order ?? 0) - 1,
    }
    tracks.push(track)
    return { track, isNew: true }
  }

  private resolvePreferredCaptionTrackId(
    tracks: readonly TimelineTrack[],
    items: readonly TimelineItem[],
    existingCaptions: ReadonlyArray<{ trackId: string }>,
    range: { startFrame: number; endFrame: number },
  ): string | null {
    const trackIds = [...new Set(existingCaptions.map((item) => item.trackId))]
    if (trackIds.length !== 1) {
      return null
    }

    const preferredTrack = tracks.find((track) => track.id === trackIds[0])
    if (!preferredTrack || !isCaptionTrackCandidate(preferredTrack, items)) {
      return null
    }

    const hasOverlap = items.some((item) => {
      if (item.trackId !== preferredTrack.id) {
        return false
      }

      const itemEnd = item.from + item.durationInFrames
      return item.from < range.endFrame && itemEnd > range.startFrame
    })

    return hasOverlap ? null : preferredTrack.id
  }
}

export const mediaTranscriptionService = new MediaTranscriptionService()
