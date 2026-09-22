/**
 * Keyframe graph panel — view-mode state and canvas settings.
 *
 * The panel's `graph | dopesheet | split` view mode (persisted to
 * localStorage), the selected-property and vector-graph-mode switches, the
 * effective mode the current surface actually renders, and the project canvas
 * settings transforms resolve against.
 *
 * Lifted verbatim out of KeyframeGraphPanel. The persisted mode is still read
 * once per mount (lazy `useState` initializer) and written back from a plain
 * effect on `editorMode`, so the panel's render isolation is unchanged.
 */

import { useEffect, useMemo, useState } from 'react'
import { useProjectStore } from '@/features/timeline/deps/projects'
import {
  DEFAULT_PROJECT_FPS,
  DEFAULT_PROJECT_HEIGHT,
  DEFAULT_PROJECT_WIDTH,
} from '@/shared/projects/defaults'
import type { AnimatableProperty } from '@/types/keyframe'
import type { CanvasSettings } from '@/types/transform'
import type { KeyframeEditorSurface } from './keyframe-graph-panel-model'

export type KeyframeEditorMode = 'graph' | 'dopesheet' | 'split'
const KEYFRAME_EDITOR_MODE_STORAGE_KEY = 'timeline:keyframeEditorMode'

function loadKeyframeEditorMode(): KeyframeEditorMode {
  try {
    const value = localStorage.getItem(KEYFRAME_EDITOR_MODE_STORAGE_KEY)
    if (value === 'graph' || value === 'dopesheet' || value === 'split') {
      return value
    }
  } catch {
    // ignore localStorage read errors
  }
  // Default to the stacked split (dopesheet on top, value graph on bottom) for
  // split-capable surfaces; non-split placements fall back to dopesheet via
  // `effectiveEditorMode`.
  return 'split'
}

interface UseKeyframeGraphPanelViewStateParams {
  surface: KeyframeEditorSurface
  splitView: boolean
}

export function useKeyframeGraphPanelViewState({
  surface,
  splitView,
}: UseKeyframeGraphPanelViewStateParams) {
  const currentProject = useProjectStore((s) => s.currentProject)
  const canvas = useMemo<CanvasSettings>(
    () => ({
      width: currentProject?.metadata.width ?? DEFAULT_PROJECT_WIDTH,
      height: currentProject?.metadata.height ?? DEFAULT_PROJECT_HEIGHT,
      fps: currentProject?.metadata.fps ?? DEFAULT_PROJECT_FPS,
    }),
    [currentProject],
  )
  // Track selected property for graph editor
  const [selectedProperty, setSelectedProperty] = useState<AnimatableProperty | null>(null)
  const [editorMode, setEditorMode] = useState<KeyframeEditorMode>(() => loadKeyframeEditorMode())
  const [vectorGraphMode, setVectorGraphMode] = useState<'value' | 'speed'>('value')
  useEffect(() => {
    try {
      localStorage.setItem(KEYFRAME_EDITOR_MODE_STORAGE_KEY, editorMode)
    } catch {
      // ignore localStorage write errors
    }
  }, [editorMode])

  // "split" is only offered in the Animate workspace (`splitView`); the docked
  // panel is too short to stack both panes, so a persisted "split" falls back
  // to the dopesheet there.
  const effectiveEditorMode: KeyframeEditorMode =
    surface === 'motion'
      ? 'graph'
      : surface === 'edit'
        ? 'dopesheet'
        : !splitView && editorMode === 'split'
          ? 'dopesheet'
          : editorMode

  return {
    canvas,
    selectedProperty,
    setSelectedProperty,
    setEditorMode,
    vectorGraphMode,
    setVectorGraphMode,
    effectiveEditorMode,
  }
}
