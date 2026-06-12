import { create } from 'zustand'
import type { VisualEffect } from '@/types/effects'

interface GradeClipboardState {
  /** Color-grade effects copied from a clip, or null when nothing was copied. */
  grade: VisualEffect[] | null
}

interface GradeClipboardActions {
  setGrade: (grade: VisualEffect[]) => void
}

/**
 * Session-scoped clipboard for copying a clip's color grade (its
 * color-category effects) onto other clips. Separate from the item
 * clipboard so copying clips and copying grades don't clobber each other.
 */
export const useGradeClipboardStore = create<GradeClipboardState & GradeClipboardActions>(
  (set) => ({
    grade: null,
    setGrade: (grade) => set({ grade }),
  }),
)
