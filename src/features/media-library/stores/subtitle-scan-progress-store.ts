/**
 * Open-state store for the subtitle scan progress dialog used by the
 * media-library "Extract Embedded Subtitles" flow. Pure cache operation —
 * unlike the timeline insert flow, this never opens the track picker. The
 * dialog is mounted once at the editor root via
 * {@link SubtitleScanProgressDialog}.
 */

import { create } from 'zustand'

interface SubtitleScanProgressEntry {
  fileName: string
  totalBytes: number
  bytesRead: number
  status: 'scanning' | 'done' | 'error'
}

export interface SubtitleScanProgressState {
  open: boolean
  /** Files in the current batch (single or multi-target). */
  entries: SubtitleScanProgressEntry[]
  /** Index of the file currently being scanned. */
  currentIndex: number
  /** Final summary line shown when the batch finishes. */
  summary: string | null
  /** Used to cancel a long scan from the dialog's "Cancel" button. */
  abort: (() => void) | null
  start: (input: {
    files: ReadonlyArray<{ fileName: string; totalBytes: number }>
    abort: () => void
  }) => void
  setCurrentIndex: (index: number) => void
  updateProgress: (bytesRead: number) => void
  markEntryStatus: (index: number, status: SubtitleScanProgressEntry['status']) => void
  finish: (summary: string) => void
  close: () => void
}

export const useSubtitleScanProgressStore = create<SubtitleScanProgressState>((set, get) => ({
  open: false,
  entries: [],
  currentIndex: 0,
  summary: null,
  abort: null,

  start: ({ files, abort }) =>
    set({
      open: true,
      entries: files.map((file) => ({
        fileName: file.fileName,
        totalBytes: file.totalBytes,
        bytesRead: 0,
        status: 'scanning',
      })),
      currentIndex: 0,
      summary: null,
      abort,
    }),

  setCurrentIndex: (currentIndex) => set({ currentIndex }),

  updateProgress: (bytesRead) =>
    set((state) => {
      const entries = state.entries.slice()
      const current = entries[state.currentIndex]
      if (!current) return state
      entries[state.currentIndex] = {
        ...current,
        bytesRead: Math.min(bytesRead, current.totalBytes),
      }
      return { entries }
    }),

  markEntryStatus: (index, status) =>
    set((state) => {
      const entries = state.entries.slice()
      const entry = entries[index]
      if (!entry) return state
      entries[index] = { ...entry, status }
      return { entries }
    }),

  finish: (summary) => set({ summary, abort: null }),

  close: () => {
    const { abort } = get()
    try {
      if (abort) abort()
    } finally {
      // Always reset state — if the caller-supplied abort throws we still
      // want the dialog closed and the stale abort reference cleared so
      // the next scan starts from a clean slate.
      set({ open: false, entries: [], currentIndex: 0, summary: null, abort: null })
    }
  },
}))
