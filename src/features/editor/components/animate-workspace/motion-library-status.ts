import type { TimelineItem } from '@/types/timeline'

/**
 * Derived flags for the Motion library.
 *
 * Plain predicates rather than a memoized bundle: they are cheap, allocation-
 * free, and the library's JSX needs them as individual booleans anyway.
 */

/** Whether the search box or the compatible-only toggle is narrowing the lists. */
export function hasActiveMotionFilters(deferredSearchQuery: string, compatibleOnly: boolean): boolean {
  return deferredSearchQuery.trim().length > 0 || compatibleOnly
}

/**
 * Whether anything at all survives the active filters — built-in presets (any
 * category), live generators, saved animations or text-motion rows. Drives the
 * "no matches" notice.
 */
export function hasVisibleMotionResults(
  visiblePresetCount: number,
  visibleModulatorCount: number,
  visibleSavedPresetCount: number,
  selectedTextItemCount: number,
): boolean {
  return (
    visiblePresetCount > 0 ||
    visibleModulatorCount > 0 ||
    visibleSavedPresetCount > 0 ||
    selectedTextItemCount > 0
  )
}

/**
 * The Edit panel's Motion-clip bridge opens the composition when a single 2D
 * composite clip is selected, and creates one otherwise.
 */
export function isMotionClipSelection(
  selectedItemCount: number,
  selectedItemKind: TimelineItem['type'] | undefined,
  compositionEditorKind: string | undefined,
): boolean {
  return (
    selectedItemCount === 1 &&
    selectedItemKind === 'composition' &&
    compositionEditorKind === 'composite-2d'
  )
}
