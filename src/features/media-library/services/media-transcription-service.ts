import {
  deleteTranscript,
  getTranscript,
  getTranscriptMediaIds,
  saveTranscript,
} from '@/infrastructure/storage'
import { usePlaybackStore } from '@/shared/state/playback'
import { useSelectionStore } from '@/shared/state/selection'
import { createLogger } from '@/shared/logging/logger'
import type { MediaTranscript, MediaTranscriptModel } from '@/types/storage'
import type {
  AudioItem,
  SubtitleSegmentItem,
  TimelineItem,
  TimelineTrack,
  VideoItem,
} from '@/types/timeline'
import type { TranscriptSegment, TranscribeOptions } from '../transcription/types'
import {
  getDefaultMediaTranscriptionAdapter,
  getMediaTranscriptionModelLabel,
} from '../transcription/registry'
import { mediaLibraryService } from './media-library-service'
import {
  buildSubtitleSegmentForClip,
  buildCaptionTrackAbove,
  findReplaceableCaptionItemsForClip,
  findCompatibleCaptionTrackForRanges,
  isCaptionTrackCandidate,
  getCaptionTextItemTemplate,
  getCaptionRangeForClip,
} from '../utils/caption-items'
import { useProjectStore } from '@/features/media-library/deps/projects'
import { useTimelineStore } from '@/features/media-library/deps/timeline-stores'
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
const DEFAULT_QUANTIZATION = DEFAULT_WHISPER_QUANTIZATION

type CaptionableClip = AudioItem | VideoItem
interface InsertTranscriptAsCaptionsOptions {
  clipIds?: readonly string[]
  replaceExisting?: boolean
}

interface InsertTranscriptAsCaptionsResult {
  insertedItemCount: number
  removedItemCount: number
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

class MediaTranscriptionService {
  private readonly adapter = getDefaultMediaTranscriptionAdapter()
  private readonly transcriber = this.adapter.createTranscriber({
    model: DEFAULT_MODEL,
    quantization: DEFAULT_QUANTIZATION,
  })
  private activeJob: QueuedTranscriptionJob | null = null
  private queue: QueuedTranscriptionJob[] = []

  getTranscript = getTranscript
  getTranscriptMediaIds = getTranscriptMediaIds

  async deleteTranscript(mediaId: string): Promise<void> {
    await deleteTranscript(mediaId)
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
      text: segments
        .map((segment) => segment.text.trim())
        .filter(Boolean)
        .join(' ')
        .trim(),
      segments: segments.map((segment) => ({
        text: segment.text.trim(),
        start: segment.start,
        end: segment.end,
      })),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    await saveTranscript(transcript)
    logger.info('Saved transcript', {
      mediaId,
      segments: transcript.segments.length,
      model: getMediaTranscriptionModelLabel(transcript.model),
    })
    return transcript
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

    const canvasWidth = project?.metadata.width ?? 1920
    const canvasHeight = project?.metadata.height ?? 1080
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
        cues: transcript.segments.map((segment, index) => ({
          id: `transcript-${clip.id}-${index}`,
          startSeconds: segment.start,
          endSeconds: segment.end,
          text: segment.text,
        })),
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
          : undefined,
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
      timeline.removeItems([...generatedCaptionIdsToRemove])
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

  private resolveCaptionTargetClips(
    mediaId: string,
    clipIds?: readonly string[],
  ): CaptionableClip[] {
    const timeline = useTimelineStore.getState()
    const selection = useSelectionStore.getState()
    const playheadFrame = usePlaybackStore.getState().currentFrame

    const matchingClips = timeline.items
      .filter(
        (item): item is CaptionableClip =>
          (item.type === 'video' || item.type === 'audio') && item.mediaId === mediaId,
      )
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
