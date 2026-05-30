import type { MediaMetadata } from '@/types/storage'
import { useMediaLibraryStore } from '@/features/media-library/stores/media-library-store'

/**
 * Seed the media-library store with provided MediaMetadata so codec lookups
 * (getMediaAudioCodecById) and source-fps conversions resolve. Without this the
 * render path can't tell that a clip is AC-3/E-AC-3 (dropping its audio), and
 * the edit path can't read media duration/fps/dimensions for addClip.
 */
export function seedMediaLibrary(
  media: ReadonlyArray<{ metadata?: MediaMetadata }> | undefined,
): void {
  const metadatas = (media ?? [])
    .map((m) => m.metadata)
    .filter((m): m is MediaMetadata => Boolean(m))
  if (metadatas.length === 0) return
  const existing = useMediaLibraryStore.getState()
  const mediaById = { ...existing.mediaById }
  for (const meta of metadatas) mediaById[meta.id] = meta
  useMediaLibraryStore.setState({ mediaItems: Object.values(mediaById), mediaById })
}
