import { usePlaybackShortcuts } from './shortcuts/use-playback-shortcuts'
import { useEditingShortcuts } from './shortcuts/use-editing-shortcuts'
import { useToolShortcuts } from './shortcuts/use-tool-shortcuts'
import { useMarkerShortcuts } from './shortcuts/use-marker-shortcuts'
import { useUIShortcuts } from './shortcuts/use-ui-shortcuts'
import { useClipboardShortcuts } from './shortcuts/use-clipboard-shortcuts'
import { useSourceMonitorShortcuts } from './shortcuts/use-source-monitor-shortcuts'

export interface TimelineShortcutCallbacks {
  onPlay?: () => void
  onPause?: () => void
  onSplit?: () => void
  onDelete?: () => void
  onUndo?: () => void
  onRedo?: () => void
  onZoomToFit?: () => void
}

/**
 * Timeline keyboard shortcuts hook
 *
 * Composes domain-specific shortcut hooks for:
 * - Playback & navigation (Space, arrows, Home/End, snap points)
 * - Editing (Delete, split, join, keyframes)
 * - Tools (V/C/R tool switching)
 * - Markers (M add/remove, [ ] navigate)
 * - UI (S snap, Z zoom, undo/redo)
 * - Clipboard (Ctrl+C/X/V)
 *
 * Note: Zoom is handled via Ctrl+Scroll only (see TimelineContent component)
 */
export function useTimelineShortcuts(callbacks: TimelineShortcutCallbacks = {}) {
  usePlaybackShortcuts(callbacks)
  useEditingShortcuts(callbacks)
  useToolShortcuts(callbacks)
  useMarkerShortcuts()
  useUIShortcuts(callbacks)
  useClipboardShortcuts()
  useSourceMonitorShortcuts()
}
