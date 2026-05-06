/**
 * Bridges AI captions (vision-language-model frame descriptions) into timeline
 * text items. Mirrors {@link MediaTranscriptionService.insertTranscriptAsCaptions}
 * but sources from `MediaCaption[]` (point-in-time descriptions) rather than
 * whisper speech-to-text segments.
 *
 * Keep both services aligned in behavior — if one gains new track-placement
 * or replacement logic, the other usually needs the same treatment.
 */

import { useSelectionStore } from '@/shared/state/selection'
import { createLogger } from '@/shared/logging/logger'
import type { MediaCaption } from '@/infrastructure/analysis'
import type { AudioItem, TextItem, TimelineItem, TimelineTrack, VideoItem } from '@/types/timeline'
import {
  aiCaptionsToSegments,
  buildCaptionTextItems,
  buildCaptionTrackAbove,
  findReplaceableCaptionItemsForClip,
  findCompatibleCaptionTrackForRanges,
  isCaptionTrackCandidate,
  getCaptionTextItemTemplate,
  getCaptionRangeForClip,
} from '../utils/caption-items'
import { useProjectStore } from '@/features/media-library/deps/projects'
import { useTimelineStore } from '@/features/media-library/deps/timeline-stores'

const logger = createLogger('MediaCaptioningService')

type CaptionableClip = AudioItem | VideoItem

interface InsertAiCaptionsOptions {
  /** Restrict insertion to these clip ids. Defaults to selection/playhead heuristics. */
  clipIds?: readonly string[]
  /** If true, pre-existing AI-caption items on matched clips are removed first. */
  replaceExisting?: boolean
  /** Sample interval reported by the captioning provider — used to size trailing caption duration. */
  sampleIntervalSec?: number
}

export interface InsertAiCaptionsResult {
  insertedItemCount: number
  removedItemCount: number
  /** `true` when no compatible clip was found on the timeline. */
  noTargetClips: boolean
}

class MediaCaptioningService {
  /**
   * Insert AI captions as timeline text items anchored to the clips that use
   * `mediaId`. Finds a compatible existing caption track per clip, or creates
   * one. Returns `noTargetClips: true` when the media isn't on the timeline
   * yet — callers should treat that as a soft outcome, not an error.
   */
  async insertAiCaptionsOnTimeline(
    mediaId: string,
    captions: readonly MediaCaption[],
    options: InsertAiCaptionsOptions = {},
  ): Promise<InsertAiCaptionsResult> {
    logger.info('insertAiCaptionsOnTimeline invoked', {
      mediaId,
      captionCount: captions.length,
      options,
    })

    if (captions.length === 0) {
      return { insertedItemCount: 0, removedItemCount: 0, noTargetClips: false }
    }

    const segments = aiCaptionsToSegments(captions, options.sampleIntervalSec)
    logger.info('aiCaptionsToSegments produced segments', {
      mediaId,
      segmentCount: segments.length,
      firstSegment: segments[0],
      lastSegment: segments.at(-1),
    })
    if (segments.length === 0) {
      return { insertedItemCount: 0, removedItemCount: 0, noTargetClips: false }
    }

    const timeline = useTimelineStore.getState()
    const project = useProjectStore.getState().currentProject
    const targetClips = this.resolveTargetClips(mediaId, options.clipIds)
    logger.info('resolveTargetClips result', {
      mediaId,
      targetClipCount: targetClips.length,
      targetClipIds: targetClips.map((c) => c.id),
      allClipsWithMediaId: timeline.items.filter((i) => 'mediaId' in i && i.mediaId === mediaId)
        .length,
    })
    if (targetClips.length === 0) {
      logger.info(`No timeline clips for media ${mediaId} — captions saved but not inserted`)
      return { insertedItemCount: 0, removedItemCount: 0, noTargetClips: true }
    }

    const canvasWidth = project?.metadata.width ?? 1920
    const canvasHeight = project?.metadata.height ?? 1080
    const newTracks: TimelineTrack[] = [...timeline.tracks]
    const generatedCaptionIdsToRemove = options.replaceExisting
      ? new Set(
          targetClips.flatMap((clip) =>
            findReplaceableCaptionItemsForClip(timeline.items, clip, 'ai-captions').map(
              (item) => item.id,
            ),
          ),
        )
      : new Set<string>()
    const plannedItems = timeline.items.filter((item) => !generatedCaptionIdsToRemove.has(item.id))
    const insertedItems: TextItem[] = []

    for (const clip of targetClips) {
      const clipRange = getCaptionRangeForClip(clip, segments, timeline.fps)
      logger.info('per-clip getCaptionRangeForClip result', {
        clipId: clip.id,
        clipFrom: clip.from,
        clipDurationInFrames: clip.durationInFrames,
        sourceStart: clip.sourceStart,
        sourceEnd: clip.sourceEnd,
        sourceFps: clip.sourceFps,
        timelineFps: timeline.fps,
        clipRange,
      })
      if (!clipRange) {
        continue
      }

      const existingGeneratedCaptions = options.replaceExisting
        ? findReplaceableCaptionItemsForClip(timeline.items, clip, 'ai-captions')
        : []
      const preferredTrackId = this.resolvePreferredTrackId(
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
        // Drop the caption track directly above the clip's own track — that's
        // where users expect overlaid subtitles. `buildCaptionTrackAbove`
        // picks a fractional order between the clip track and the next track
        // up so no existing tracks need to shift.
        const clipTrack = newTracks.find((track) => track.id === clip.trackId)
        targetTrack = clipTrack
          ? buildCaptionTrackAbove(newTracks, clipTrack.order)
          : buildCaptionTrackAbove(newTracks, 0)
        newTracks.push(targetTrack)
        newTracks.sort((a, b) => a.order - b.order)
      }

      const clipCaptionItems = buildCaptionTextItems({
        mediaId,
        trackId: targetTrack.id,
        segments,
        clip,
        timelineFps: timeline.fps,
        canvasWidth,
        canvasHeight,
        sourceType: 'ai-captions',
        styleTemplate: existingGeneratedCaptions[0]
          ? getCaptionTextItemTemplate(existingGeneratedCaptions[0])
          : undefined,
      })
      logger.info('buildCaptionTextItems produced items', {
        clipId: clip.id,
        trackId: targetTrack.id,
        itemCount: clipCaptionItems.length,
      })

      if (clipCaptionItems.length === 0) {
        continue
      }

      insertedItems.push(...clipCaptionItems)
      plannedItems.push(...clipCaptionItems)
    }

    logger.info('insertAiCaptionsOnTimeline finishing', {
      mediaId,
      insertedItemCount: insertedItems.length,
      removedItemCount: generatedCaptionIdsToRemove.size,
      trackChangeCount: newTracks.length - timeline.tracks.length,
    })

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
      noTargetClips: false,
    }
  }

  private resolveTargetClips(mediaId: string, clipIds?: readonly string[]): CaptionableClip[] {
    const timeline = useTimelineStore.getState()
    const selection = useSelectionStore.getState()

    const matchingClips = timeline.items
      .filter(
        (item): item is CaptionableClip =>
          (item.type === 'video' || item.type === 'audio') && item.mediaId === mediaId,
      )
      .sort((a, b) => a.from - b.from)

    if (matchingClips.length === 0) return []

    if (clipIds && clipIds.length > 0) {
      const requested = new Set(clipIds)
      return matchingClips.filter((clip) => requested.has(clip.id))
    }

    const selectedClips = selection.selectedItemIds
      .map((id) => matchingClips.find((clip) => clip.id === id))
      .filter((clip): clip is CaptionableClip => clip !== undefined)
    if (selectedClips.length > 0) return selectedClips

    // Default: caption every clip that uses this media. The whisper flow
    // picks a single clip when many exist (it's long-form speech), but AI
    // frame captions are inherently per-frame-range — applying to all clips
    // is the less surprising default here.
    return matchingClips
  }

  private resolvePreferredTrackId(
    tracks: readonly TimelineTrack[],
    items: readonly TimelineItem[],
    existingCaptions: ReadonlyArray<{ trackId: string }>,
    range: { startFrame: number; endFrame: number },
  ): string | null {
    const trackIds = [...new Set(existingCaptions.map((item) => item.trackId))]
    if (trackIds.length !== 1) return null

    const preferredTrack = tracks.find((track) => track.id === trackIds[0])
    if (!preferredTrack || !isCaptionTrackCandidate(preferredTrack, items)) {
      return null
    }

    const hasOverlap = items.some((item) => {
      if (item.trackId !== preferredTrack.id) return false
      const itemEnd = item.from + item.durationInFrames
      return item.from < range.endFrame && itemEnd > range.startFrame
    })

    return hasOverlap ? null : preferredTrack.id
  }
}

export const mediaCaptioningService = new MediaCaptioningService()
