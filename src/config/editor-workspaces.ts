/**
 * Editor workspaces (DaVinci-style pages): named layout presets that
 * rearrange existing panels for a task. Switching workspaces never changes
 * project state — only which panels are visible and which tabs are active.
 *
 * Presets are starting points, not locks: the user can still toggle any
 * panel inside a workspace, and their per-workspace tweaks are persisted
 * by the editor store (`editor:workspaceLayout:<id>` in localStorage).
 */
export type EditorWorkspaceId = 'edit' | 'color'

export type EditorSidebarTab = 'media' | 'text' | 'shapes' | 'effects' | 'transitions' | 'ai'
export type EditorClipInspectorTab = 'video' | 'audio' | 'effects'

/** The slice of editor UI state that a workspace controls. */
export interface EditorWorkspaceLayout {
  colorScopesOpen: boolean
  clipInspectorTab: EditorClipInspectorTab
  activeTab: EditorSidebarTab
  propertiesFullColumn: boolean
}

const EDITOR_WORKSPACE_PRESETS: Record<EditorWorkspaceId, EditorWorkspaceLayout> = {
  edit: {
    colorScopesOpen: false,
    clipInspectorTab: 'video',
    activeTab: 'media',
    propertiesFullColumn: false,
  },
  color: {
    colorScopesOpen: true,
    clipInspectorTab: 'effects',
    activeTab: 'effects',
    // The grade panel stacks wheels + curves + the effect list — give it
    // the full column height by default.
    propertiesFullColumn: true,
  },
}

/**
 * Timeline split (percent of vertical space) a workspace starts with.
 * `null` means "use the density preset default" — grading navigates clips
 * rather than editing them, so the color workspace shrinks the timeline.
 */
export const EDITOR_WORKSPACE_TIMELINE_SIZE: Record<EditorWorkspaceId, number | null> = {
  edit: null,
  color: 18,
}

const DEFAULT_EDITOR_WORKSPACE: EditorWorkspaceId = 'edit'

export function normalizeEditorWorkspaceId(value: unknown): EditorWorkspaceId {
  return value === 'color' ? 'color' : DEFAULT_EDITOR_WORKSPACE
}

const SIDEBAR_TABS: readonly EditorSidebarTab[] = [
  'media',
  'text',
  'shapes',
  'effects',
  'transitions',
  'ai',
]
const CLIP_INSPECTOR_TABS: readonly EditorClipInspectorTab[] = ['video', 'audio', 'effects']

function isSidebarTab(value: unknown): value is EditorSidebarTab {
  return SIDEBAR_TABS.includes(value as EditorSidebarTab)
}

function isClipInspectorTab(value: unknown): value is EditorClipInspectorTab {
  return CLIP_INSPECTOR_TABS.includes(value as EditorClipInspectorTab)
}

/** Validate a persisted workspace layout, falling back per-field to the preset. */
export function normalizeEditorWorkspaceLayout(
  value: unknown,
  workspace: EditorWorkspaceId,
): EditorWorkspaceLayout {
  const preset = EDITOR_WORKSPACE_PRESETS[workspace]
  if (!value || typeof value !== 'object') return preset
  const candidate = value as Partial<Record<keyof EditorWorkspaceLayout, unknown>>

  return {
    colorScopesOpen:
      typeof candidate.colorScopesOpen === 'boolean'
        ? candidate.colorScopesOpen
        : preset.colorScopesOpen,
    clipInspectorTab: isClipInspectorTab(candidate.clipInspectorTab)
      ? candidate.clipInspectorTab
      : preset.clipInspectorTab,
    activeTab: isSidebarTab(candidate.activeTab) ? candidate.activeTab : preset.activeTab,
    propertiesFullColumn:
      typeof candidate.propertiesFullColumn === 'boolean'
        ? candidate.propertiesFullColumn
        : preset.propertiesFullColumn,
  }
}
