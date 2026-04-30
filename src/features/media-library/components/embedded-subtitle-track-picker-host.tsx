/**
 * Single mount point for the embedded subtitle track picker.
 *
 * Subscribes to {@link useEmbeddedSubtitlePickerStore} and renders the
 * picker dialog when `media` is non-null. After insertion succeeds the
 * store is closed and a success toast is fired via the media library
 * notification channel.
 */

import { useState } from 'react'

import { useEmbeddedSubtitlePickerStore } from '../stores/embedded-subtitle-picker-store'
import { useMediaLibraryStore } from '../stores/media-library-store'
import {
  subtitleSidecarService,
  type ExtractEmbeddedSubtitlesResult,
} from '../services/subtitle-sidecar-service'
import type { EmbeddedSubtitleTrack } from '@/shared/utils/matroska-subtitles'

import { EmbeddedSubtitleTrackPicker } from './embedded-subtitle-track-picker'

export function EmbeddedSubtitleTrackPickerHost() {
  const media = useEmbeddedSubtitlePickerStore((s) => s.media)
  const blob = useEmbeddedSubtitlePickerStore((s) => s.blob)
  const errorMessage = useEmbeddedSubtitlePickerStore((s) => s.errorMessage)
  const setError = useEmbeddedSubtitlePickerStore((s) => s.setError)
  const close = useEmbeddedSubtitlePickerStore((s) => s.close)
  const [insertMode, setInsertMode] = useState<'segment' | 'per-cue'>('segment')

  const handlePicked = (track: EmbeddedSubtitleTrack) => {
    if (!media) return
    const store = useMediaLibraryStore.getState()
    let result: ExtractEmbeddedSubtitlesResult
    try {
      result = subtitleSidecarService.insertEmbeddedSubtitleTrack(media, track, {
        mode: insertMode,
      })
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to insert subtitles.')
      return
    }
    close()
    const noun = insertMode === 'segment' ? 'subtitle segment' : 'caption'
    store.showNotification({
      type: 'success',
      message:
        result.insertedItemCount > 0
          ? `Inserted ${result.insertedItemCount} ${noun}${result.insertedItemCount === 1 ? '' : 's'} from "${result.trackLabel}".`
          : `No cues fell inside the clip's range for "${result.trackLabel}".`,
    })
  }

  return (
    <EmbeddedSubtitleTrackPicker
      media={media}
      blob={blob}
      errorMessage={errorMessage}
      insertMode={insertMode}
      onInsertModeChange={setInsertMode}
      onClose={close}
      onTrackPicked={handlePicked}
    />
  )
}
