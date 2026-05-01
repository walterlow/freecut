/**
 * Open-state store for the embedded-subtitle track picker dialog.
 *
 * The picker is mounted once at the editor root via
 * `EmbeddedSubtitleTrackPickerHost` and dispatched from anywhere — the media
 * card menu, the clip context menu, etc. Centralizing the open state means
 * only one dialog can be active at a time and the heavy parser/scan work
 * happens in one place.
 */

import { create } from 'zustand'

import type { MediaMetadata } from '@/types/storage'

interface EmbeddedSubtitlePickerState {
  /** When non-null, the picker is open for this media. */
  media: MediaMetadata | null
  /** Caller-resolved blob handle (after permission + open). */
  blob: Blob | null
  /** Last error surfaced inside the picker (e.g. insertion failure). */
  errorMessage: string | null
  open: (media: MediaMetadata, blob: Blob) => void
  setError: (message: string | null) => void
  close: () => void
}

export const useEmbeddedSubtitlePickerStore = create<EmbeddedSubtitlePickerState>((set) => ({
  media: null,
  blob: null,
  errorMessage: null,
  open: (media, blob) => set({ media, blob, errorMessage: null }),
  setError: (errorMessage) => set({ errorMessage }),
  close: () => set({ media: null, blob: null, errorMessage: null }),
}))
