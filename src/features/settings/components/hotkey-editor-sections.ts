import {
  formatHotkeyBinding,
  normalizeHotkeyBinding,
  type HotkeyBindingMap,
  type HotkeyKey,
} from '@/config/hotkeys'

export interface HotkeyEditorItem {
  /** i18n key for the command label */
  labelKey: string
  keys: readonly HotkeyKey[]
}

export interface HotkeyEditorSection {
  /** i18n key for the section title */
  titleKey: string
  /** i18n key for the section blurb */
  blurbKey: string
  /**
   * i18n key describing where these shortcuts are active, for sections whose
   * commands only fire while a specific panel owns focus. Omitted for globally
   * active sections.
   */
  scopeKey?: string
  items: readonly HotkeyEditorItem[]
}

export interface HotkeyEditorSearchResult {
  section: HotkeyEditorSection
  item: HotkeyEditorItem
}

interface HotkeyEditorSearchOptions {
  query: string
  sections: readonly HotkeyEditorSection[]
  hotkeys: HotkeyBindingMap
  translate: (key: string) => string
}

export function getHotkeyBindingDisplayLabel(binding: string, unassignedLabel: string): string {
  return binding ? formatHotkeyBinding(binding) : unassignedLabel
}

export function getHotkeyEditorSearchResults({
  query,
  sections,
  hotkeys,
  translate,
}: HotkeyEditorSearchOptions): HotkeyEditorSearchResult[] {
  const normalizedQuery = query.trim().toLowerCase()

  if (!normalizedQuery) {
    return []
  }

  const normalizedBindingQuery = normalizeHotkeyBinding(normalizedQuery)

  return sections.flatMap((section) => {
    const sectionLabel = translate(section.titleKey).toLowerCase()

    return section.items
      .filter((item) => {
        const itemLabel = translate(item.labelKey).toLowerCase()
        const bindings = item.keys.map((key) => hotkeys[key].toLowerCase())

        return (
          itemLabel.includes(normalizedQuery) ||
          sectionLabel.includes(normalizedQuery) ||
          item.keys.some((key) => key.toLowerCase().includes(normalizedQuery)) ||
          bindings.some(
            (binding) =>
              binding.includes(normalizedQuery) ||
              (normalizedBindingQuery.length > 0 && binding === normalizedBindingQuery),
          )
        )
      })
      .map((item) => ({ section, item }))
  })
}

export const HOTKEY_EDITOR_SECTIONS: readonly HotkeyEditorSection[] = [
  {
    titleKey: 'projects.settings.hotkeys.sections.playback.title',
    blurbKey: 'projects.settings.hotkeys.sections.playback.blurb',
    items: [
      {
        labelKey: 'projects.settings.hotkeys.items.playPause',
        keys: ['PLAY_PAUSE'],
      },
      {
        labelKey: 'projects.settings.hotkeys.items.previousFrame',
        keys: ['PREVIOUS_FRAME'],
      },
      {
        labelKey: 'projects.settings.hotkeys.items.nextFrame',
        keys: ['NEXT_FRAME'],
      },
      {
        labelKey: 'projects.settings.hotkeys.items.goToStart',
        keys: ['GO_TO_START'],
      },
      {
        labelKey: 'projects.settings.hotkeys.items.goToEnd',
        keys: ['GO_TO_END'],
      },
      {
        labelKey: 'projects.settings.hotkeys.items.previousSnapPoint',
        keys: ['PREVIOUS_SNAP_POINT'],
      },
      {
        labelKey: 'projects.settings.hotkeys.items.nextSnapPoint',
        keys: ['NEXT_SNAP_POINT'],
      },
    ],
  },
  {
    titleKey: 'projects.settings.hotkeys.sections.editing.title',
    blurbKey: 'projects.settings.hotkeys.sections.editing.blurb',
    items: [
      {
        labelKey: 'projects.settings.hotkeys.items.splitAtPlayhead',
        keys: ['SPLIT_AT_PLAYHEAD_ALT'],
      },
      {
        labelKey: 'projects.settings.hotkeys.items.joinSelectedClips',
        keys: ['JOIN_ITEMS'],
      },
      {
        labelKey: 'projects.settings.hotkeys.items.deleteSelectedItems',
        keys: ['DELETE_SELECTED', 'DELETE_SELECTED_ALT'],
      },
      {
        labelKey: 'projects.settings.hotkeys.items.rippleDeleteSelectedItems',
        keys: ['RIPPLE_DELETE', 'RIPPLE_DELETE_ALT'],
      },
      {
        labelKey: 'projects.settings.hotkeys.items.insertFreezeFrame',
        keys: ['FREEZE_FRAME'],
      },
      {
        labelKey: 'projects.settings.hotkeys.items.linkSelectedClips',
        keys: ['LINK_AUDIO_VIDEO'],
      },
      {
        labelKey: 'projects.settings.hotkeys.items.unlinkSelectedClips',
        keys: ['UNLINK_AUDIO_VIDEO'],
      },
      {
        labelKey: 'projects.settings.hotkeys.items.toggleLinkedSelection',
        keys: ['TOGGLE_LINKED_SELECTION'],
      },
      {
        labelKey: 'projects.settings.hotkeys.items.nudge1px',
        keys: ['NUDGE_LEFT', 'NUDGE_RIGHT', 'NUDGE_UP', 'NUDGE_DOWN'],
      },
      {
        labelKey: 'projects.settings.hotkeys.items.nudge10px',
        keys: ['NUDGE_LEFT_LARGE', 'NUDGE_RIGHT_LARGE', 'NUDGE_UP_LARGE', 'NUDGE_DOWN_LARGE'],
      },
    ],
  },
  {
    titleKey: 'projects.settings.hotkeys.sections.tools.title',
    blurbKey: 'projects.settings.hotkeys.sections.tools.blurb',
    items: [
      {
        labelKey: 'projects.settings.hotkeys.items.selectionTool',
        keys: ['SELECTION_TOOL'],
      },
      {
        labelKey: 'projects.settings.hotkeys.items.trimEditTool',
        keys: ['TRIM_EDIT_TOOL'],
      },
      {
        labelKey: 'projects.settings.hotkeys.items.razorTool',
        keys: ['RAZOR_TOOL'],
      },
      {
        labelKey: 'projects.settings.hotkeys.items.splitAtCursor',
        keys: ['SPLIT_AT_CURSOR'],
      },
      {
        labelKey: 'projects.settings.hotkeys.items.rateStretchTool',
        keys: ['RATE_STRETCH_TOOL'],
      },
      {
        labelKey: 'projects.settings.hotkeys.items.slipTool',
        keys: ['SLIP_TOOL'],
      },
      {
        labelKey: 'projects.settings.hotkeys.items.slideTool',
        keys: ['SLIDE_TOOL'],
      },
    ],
  },
  {
    titleKey: 'projects.settings.hotkeys.sections.historyAndUi.title',
    blurbKey: 'projects.settings.hotkeys.sections.historyAndUi.blurb',
    items: [
      { labelKey: 'projects.settings.hotkeys.items.undo', keys: ['UNDO'] },
      { labelKey: 'projects.settings.hotkeys.items.redo', keys: ['REDO'] },
      { labelKey: 'projects.settings.hotkeys.items.zoomIn', keys: ['ZOOM_IN'] },
      {
        labelKey: 'projects.settings.hotkeys.items.zoomOut',
        keys: ['ZOOM_OUT'],
      },
      {
        labelKey: 'projects.settings.hotkeys.items.zoomToFit',
        keys: ['ZOOM_TO_FIT'],
      },
      {
        labelKey: 'projects.settings.hotkeys.items.zoomTo100',
        keys: ['ZOOM_TO_100', 'ZOOM_TO_100_ALT'],
      },
      {
        labelKey: 'projects.settings.hotkeys.items.toggleSnap',
        keys: ['TOGGLE_SNAP'],
      },
      {
        labelKey: 'projects.settings.hotkeys.items.toggleCanvasSnap',
        keys: ['TOGGLE_CANVAS_SNAP'],
      },
      {
        labelKey: 'projects.settings.hotkeys.items.editWorkspace',
        keys: ['WORKSPACE_EDIT'],
      },
      {
        labelKey: 'projects.settings.hotkeys.items.colorWorkspace',
        keys: ['WORKSPACE_COLOR'],
      },
      {
        labelKey: 'toolbar.workspaces.motion',
        keys: ['WORKSPACE_ANIMATE'],
      },
    ],
  },
  {
    titleKey: 'projects.settings.hotkeys.sections.clipboard.title',
    blurbKey: 'projects.settings.hotkeys.sections.clipboard.blurb',
    items: [
      { labelKey: 'projects.settings.hotkeys.items.copy', keys: ['COPY'] },
      { labelKey: 'projects.settings.hotkeys.items.cut', keys: ['CUT'] },
      { labelKey: 'projects.settings.hotkeys.items.paste', keys: ['PASTE'] },
    ],
  },
  {
    titleKey: 'projects.settings.hotkeys.sections.markers.title',
    blurbKey: 'projects.settings.hotkeys.sections.markers.blurb',
    items: [
      {
        labelKey: 'projects.settings.hotkeys.items.addMarker',
        keys: ['ADD_MARKER'],
      },
      {
        labelKey: 'projects.settings.hotkeys.items.removeMarker',
        keys: ['REMOVE_MARKER'],
      },
      {
        labelKey: 'projects.settings.hotkeys.items.previousMarker',
        keys: ['PREVIOUS_MARKER'],
      },
      {
        labelKey: 'projects.settings.hotkeys.items.nextMarker',
        keys: ['NEXT_MARKER'],
      },
    ],
  },
  {
    titleKey: 'projects.settings.hotkeys.sections.keyframes.title',
    blurbKey: 'projects.settings.hotkeys.sections.keyframes.blurb',
    scopeKey: 'projects.settings.hotkeys.scopes.keyframes',
    items: [
      {
        labelKey: 'projects.settings.hotkeys.items.clearKeyframes',
        keys: ['CLEAR_KEYFRAMES'],
      },
      {
        labelKey: 'projects.settings.hotkeys.items.keyframeEditorGraph',
        keys: ['KEYFRAME_EDITOR_GRAPH'],
      },
      {
        labelKey: 'projects.settings.hotkeys.items.keyframeEditorDopesheet',
        keys: ['KEYFRAME_EDITOR_DOPESHEET'],
      },
      {
        labelKey: 'projects.settings.hotkeys.items.keyframeEditorSplit',
        keys: ['KEYFRAME_EDITOR_SPLIT'],
      },
      {
        labelKey: 'projects.settings.hotkeys.items.editKeyframeAdd',
        keys: ['EDIT_KEYFRAME_ADD'],
      },
      {
        labelKey: 'projects.settings.hotkeys.items.keyframePrevious',
        keys: ['KEYFRAME_PREVIOUS'],
      },
      {
        labelKey: 'projects.settings.hotkeys.items.keyframeNext',
        keys: ['KEYFRAME_NEXT'],
      },
      {
        labelKey: 'projects.settings.hotkeys.items.keyframeToggleAuto',
        keys: ['KEYFRAME_TOGGLE_AUTO'],
      },
      {
        labelKey: 'projects.settings.hotkeys.items.keyframeFit',
        keys: ['KEYFRAME_FIT'],
      },
    ],
  },
  {
    titleKey: 'projects.settings.hotkeys.sections.sourceMonitor.title',
    blurbKey: 'projects.settings.hotkeys.sections.sourceMonitor.blurb',
    scopeKey: 'projects.settings.hotkeys.scopes.sourceMonitor',
    items: [
      { labelKey: 'projects.settings.hotkeys.items.markIn', keys: ['MARK_IN'] },
      {
        labelKey: 'projects.settings.hotkeys.items.markOut',
        keys: ['MARK_OUT'],
      },
      {
        labelKey: 'projects.settings.hotkeys.items.clearInOut',
        keys: ['CLEAR_IN_OUT'],
      },
      {
        labelKey: 'projects.settings.hotkeys.items.insertEdit',
        keys: ['INSERT_EDIT'],
      },
      {
        labelKey: 'projects.settings.hotkeys.items.overwriteEdit',
        keys: ['OVERWRITE_EDIT'],
      },
    ],
  },
  {
    titleKey: 'projects.settings.hotkeys.sections.project.title',
    blurbKey: 'projects.settings.hotkeys.sections.project.blurb',
    items: [
      {
        labelKey: 'projects.settings.hotkeys.items.saveProject',
        keys: ['SAVE'],
      },
      {
        labelKey: 'projects.settings.hotkeys.items.exportVideo',
        keys: ['EXPORT'],
      },
      {
        labelKey: 'projects.settings.hotkeys.items.openSceneBrowser',
        keys: ['OPEN_SCENE_BROWSER'],
      },
    ],
  },
] as const
