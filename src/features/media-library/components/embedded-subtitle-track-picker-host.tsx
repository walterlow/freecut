/**
 * Single mount point for the embedded subtitle track picker.
 *
 * Subscribes to {@link useEmbeddedSubtitlePickerStore} and renders the
 * picker dialog when `media` is non-null. After insertion succeeds the
 * store is closed and a success toast is fired via the media library
 * notification channel.
 */

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

  const handlePicked = (track: EmbeddedSubtitleTrack) => {
    if (!media) return
    const store = useMediaLibraryStore.getState()
    let result: ExtractEmbeddedSubtitlesResult
    try {
      result = subtitleSidecarService.insertEmbeddedSubtitleTrack(media, track)
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to insert subtitles.')
      return
    }
    close()
    store.showNotification({
      type: 'success',
      message:
        result.insertedItemCount > 0
          ? `Inserted ${result.insertedItemCount} subtitle segment${result.insertedItemCount === 1 ? '' : 's'} from "${result.trackLabel}".`
          : `No cues fell inside the clip's range for "${result.trackLabel}".`,
    })
  }

  return (
    <EmbeddedSubtitleTrackPicker
      media={media}
      blob={blob}
      errorMessage={errorMessage}
      onClose={close}
      onTrackPicked={handlePicked}
    />
  )
}
