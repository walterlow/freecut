import { create } from 'zustand'
import {
  DEFAULT_FILLER_REMOVAL_SETTINGS,
  type FillerPreviewSummary,
  type FillerRangesByMediaId,
  type FillerRemovalSettings,
} from '../utils/filler-word-removal-preview'

interface FillerRemovalDialogState {
  isOpen: boolean
  itemIds: string[]
  settings: FillerRemovalSettings
  rangesByMediaId: FillerRangesByMediaId
  summary: FillerPreviewSummary
}

interface FillerRemovalDialogActions {
  open: (request: {
    itemIds: string[]
    settings?: FillerRemovalSettings
    rangesByMediaId?: FillerRangesByMediaId
    summary?: FillerPreviewSummary
  }) => void
  updatePreview: (request: {
    settings: FillerRemovalSettings
    rangesByMediaId: FillerRangesByMediaId
    summary: FillerPreviewSummary
  }) => void
  close: () => void
}

export const useFillerRemovalDialogStore = create<
  FillerRemovalDialogState & FillerRemovalDialogActions
>((set) => ({
  isOpen: false,
  itemIds: [],
  settings: DEFAULT_FILLER_REMOVAL_SETTINGS,
  rangesByMediaId: {},
  summary: { rangeCount: 0, totalSeconds: 0 },

  open: (request) =>
    set({
      isOpen: true,
      itemIds: request.itemIds,
      settings: request.settings ?? DEFAULT_FILLER_REMOVAL_SETTINGS,
      rangesByMediaId: request.rangesByMediaId ?? {},
      summary: request.summary ?? { rangeCount: 0, totalSeconds: 0 },
    }),

  updatePreview: (request) =>
    set({
      settings: request.settings,
      rangesByMediaId: request.rangesByMediaId,
      summary: request.summary,
    }),

  close: () =>
    set({
      isOpen: false,
      itemIds: [],
      rangesByMediaId: {},
      summary: { rangeCount: 0, totalSeconds: 0 },
    }),
}))
