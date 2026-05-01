import { create } from 'zustand'
import {
  DEFAULT_SILENCE_REMOVAL_SETTINGS,
  type SilenceRangesByMediaId,
  type SilenceRemovalSettings,
  type SilencePreviewSummary,
} from '../utils/silence-removal-preview'

interface SilenceRemovalDialogState {
  isOpen: boolean
  itemIds: string[]
  settings: SilenceRemovalSettings
  rangesByMediaId: SilenceRangesByMediaId
  summary: SilencePreviewSummary
}

interface SilenceRemovalDialogActions {
  open: (request: {
    itemIds: string[]
    settings?: SilenceRemovalSettings
    rangesByMediaId?: SilenceRangesByMediaId
    summary?: SilencePreviewSummary
  }) => void
  updatePreview: (request: {
    settings: SilenceRemovalSettings
    rangesByMediaId: SilenceRangesByMediaId
    summary: SilencePreviewSummary
  }) => void
  close: () => void
}

export const useSilenceRemovalDialogStore = create<
  SilenceRemovalDialogState & SilenceRemovalDialogActions
>((set) => ({
  isOpen: false,
  itemIds: [],
  settings: DEFAULT_SILENCE_REMOVAL_SETTINGS,
  rangesByMediaId: {},
  summary: { rangeCount: 0, totalSeconds: 0 },

  open: (request) =>
    set({
      isOpen: true,
      itemIds: request.itemIds,
      settings: request.settings ?? DEFAULT_SILENCE_REMOVAL_SETTINGS,
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
