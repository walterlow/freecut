import { describe, expect, it, beforeEach } from 'vite-plus/test'
import { useEditorStore } from './editor-store'
import {
  DEFAULT_EDITOR_DENSITY_PRESET,
  getEditorLayout,
  getLeftEditorSidebarBounds,
} from '@/config/editor-layout'
import { useSettingsStore } from '@/features/editor/deps/settings'
import { usePlaybackStore } from '@/shared/state/playback'

describe('editor-store', () => {
  beforeEach(() => {
    useSettingsStore.getState().setSetting('editorDensity', DEFAULT_EDITOR_DENSITY_PRESET)
    const editorLayout = getEditorLayout(DEFAULT_EDITOR_DENSITY_PRESET)

    // Clear persisted workspace layouts so tests are order-independent
    localStorage.removeItem('editor:workspace')
    localStorage.removeItem('editor:workspaceLayout:edit')
    localStorage.removeItem('editor:workspaceLayout:color')
    localStorage.removeItem('editor:workspaceLayout:animate')
    localStorage.removeItem('editor:workspaceTimelineSize:edit')
    localStorage.removeItem('editor:workspaceTimelineSize:color')
    localStorage.removeItem('editor:workspaceTimelineSize:animate')
    localStorage.removeItem('editor:propertiesFullColumn')

    // Reset store to defaults between tests
    useEditorStore.setState({
      activePanel: null,
      workspace: 'edit',
      panelPosition: 'bottom',
      layoutEditing: false,
      layoutResetVersion: 0,
      leftSidebarOpen: true,
      rightSidebarOpen: true,
      keyframeEditorShortcutScopeActive: false,
      activeTab: 'media',
      clipInspectorTab: 'video',
      sidebarWidth: editorLayout.leftSidebarDefaultWidth,
      rightSidebarWidth: editorLayout.rightSidebarDefaultWidth,
      timelineHeight: 250,
      sourcePreviewMediaId: null,
      mediaSkimPreviewMediaId: null,
      mediaSkimPreviewFrame: null,
      compoundClipSkimPreviewCompositionId: null,
      compoundClipSkimPreviewFrame: null,
      sourcePatchVideoEnabled: true,
      sourcePatchAudioEnabled: true,
      sourcePatchVideoTrackId: null,
      sourcePatchAudioTrackId: null,
      linkedSelectionEnabled: true,
      colorScopesOpen: false,
      propertiesFullColumn: false,
      mediaFullColumn: true,
    })
    usePlaybackStore.setState({ isPlaying: false, previewFrame: null, previewItemId: null })
  })

  it('sets active panel', () => {
    useEditorStore.getState().setActivePanel('media')
    expect(useEditorStore.getState().activePanel).toBe('media')

    useEditorStore.getState().setActivePanel(null)
    expect(useEditorStore.getState().activePanel).toBe(null)
  })

  it('toggles left sidebar', () => {
    expect(useEditorStore.getState().leftSidebarOpen).toBe(true)

    useEditorStore.getState().toggleLeftSidebar()
    expect(useEditorStore.getState().leftSidebarOpen).toBe(false)

    useEditorStore.getState().toggleLeftSidebar()
    expect(useEditorStore.getState().leftSidebarOpen).toBe(true)
  })

  it('toggles right sidebar', () => {
    expect(useEditorStore.getState().rightSidebarOpen).toBe(true)

    useEditorStore.getState().toggleRightSidebar()
    expect(useEditorStore.getState().rightSidebarOpen).toBe(false)

    useEditorStore.getState().toggleRightSidebar()
    expect(useEditorStore.getState().rightSidebarOpen).toBe(true)
  })

  it('sets active tab', () => {
    useEditorStore.getState().setActiveTab('effects')
    expect(useEditorStore.getState().activeTab).toBe('effects')

    useEditorStore.getState().setActiveTab('transitions')
    expect(useEditorStore.getState().activeTab).toBe('transitions')

    useEditorStore.getState().setActiveTab('ai')
    expect(useEditorStore.getState().activeTab).toBe('ai')
  })

  it('sets clip inspector tab', () => {
    useEditorStore.getState().setClipInspectorTab('effects')
    expect(useEditorStore.getState().clipInspectorTab).toBe('effects')

    useEditorStore.getState().setClipInspectorTab('audio')
    expect(useEditorStore.getState().clipInspectorTab).toBe('audio')
  })

  it('sets sidebar widths', () => {
    useEditorStore.getState().setSidebarWidth(400)
    expect(useEditorStore.getState().sidebarWidth).toBe(400)

    useEditorStore.getState().setRightSidebarWidth(250)
    expect(useEditorStore.getState().rightSidebarWidth).toBe(250)
  })

  it('sets timeline height', () => {
    useEditorStore.getState().setTimelineHeight(300)
    expect(useEditorStore.getState().timelineHeight).toBe(300)
  })

  it('sets source preview media id', () => {
    useEditorStore.getState().setMediaSkimPreview('media-hover', 12)
    useEditorStore.getState().setSourcePreviewMediaId('media-123')
    expect(useEditorStore.getState().sourcePreviewMediaId).toBe('media-123')
    expect(useEditorStore.getState().mediaSkimPreviewMediaId).toBe(null)
    expect(useEditorStore.getState().mediaSkimPreviewFrame).toBe(null)
    expect(useEditorStore.getState().compoundClipSkimPreviewCompositionId).toBe(null)
    expect(useEditorStore.getState().compoundClipSkimPreviewFrame).toBe(null)

    useEditorStore.getState().setSourcePreviewMediaId(null)
    expect(useEditorStore.getState().sourcePreviewMediaId).toBe(null)
  })

  it('tracks media skim preview state', () => {
    useEditorStore.getState().setMediaSkimPreview('media-123', 45)
    expect(useEditorStore.getState().mediaSkimPreviewMediaId).toBe('media-123')
    expect(useEditorStore.getState().mediaSkimPreviewFrame).toBe(45)

    useEditorStore.getState().clearMediaSkimPreview()
    expect(useEditorStore.getState().mediaSkimPreviewMediaId).toBe(null)
    expect(useEditorStore.getState().mediaSkimPreviewFrame).toBe(null)
  })

  it('tracks compound clip skim preview state', () => {
    useEditorStore.getState().setCompoundClipSkimPreview('composition-123', 18)
    expect(useEditorStore.getState().compoundClipSkimPreviewCompositionId).toBe('composition-123')
    expect(useEditorStore.getState().compoundClipSkimPreviewFrame).toBe(18)
    expect(useEditorStore.getState().mediaSkimPreviewMediaId).toBe(null)
    expect(useEditorStore.getState().mediaSkimPreviewFrame).toBe(null)

    useEditorStore.getState().clearCompoundClipSkimPreview()
    expect(useEditorStore.getState().compoundClipSkimPreviewCompositionId).toBe(null)
    expect(useEditorStore.getState().compoundClipSkimPreviewFrame).toBe(null)
  })

  it('does not publish a new state object when skim preview values are unchanged', () => {
    useEditorStore.getState().setMediaSkimPreview('media-123', 45)
    const currentState = useEditorStore.getState()

    useEditorStore.getState().setMediaSkimPreview('media-123', 45)
    expect(useEditorStore.getState()).toBe(currentState)

    useEditorStore.getState().clearMediaSkimPreview()
    const clearedState = useEditorStore.getState()

    useEditorStore.getState().clearMediaSkimPreview()
    expect(useEditorStore.getState()).toBe(clearedState)

    useEditorStore.getState().setCompoundClipSkimPreview('composition-123', 18)
    const compoundCurrentState = useEditorStore.getState()

    useEditorStore.getState().setCompoundClipSkimPreview('composition-123', 18)
    expect(useEditorStore.getState()).toBe(compoundCurrentState)

    useEditorStore.getState().clearCompoundClipSkimPreview()
    const compoundClearedState = useEditorStore.getState()

    useEditorStore.getState().clearCompoundClipSkimPreview()
    expect(useEditorStore.getState()).toBe(compoundClearedState)
  })

  it('toggles the color scopes monitor', () => {
    expect(useEditorStore.getState().colorScopesOpen).toBe(false)

    useEditorStore.getState().toggleColorScopesOpen()
    expect(useEditorStore.getState().colorScopesOpen).toBe(true)

    useEditorStore.getState().setColorScopesOpen(false)
    expect(useEditorStore.getState().colorScopesOpen).toBe(false)
  })

  it('applies the workspace preset when switching workspaces', () => {
    expect(useEditorStore.getState().workspace).toBe('edit')

    useEditorStore.getState().setWorkspace('color')

    const state = useEditorStore.getState()
    expect(state.workspace).toBe('color')
    expect(state.colorScopesOpen).toBe(true)
    expect(state.clipInspectorTab).toBe('effects')
    expect(state.activeTab).toBe('effects')

    useEditorStore.getState().setWorkspace('edit')

    const editState = useEditorStore.getState()
    expect(editState.workspace).toBe('edit')
    expect(editState.colorScopesOpen).toBe(false)
    expect(editState.clipInspectorTab).toBe('video')
    expect(editState.activeTab).toBe('media')
  })

  it('remembers per-workspace layout tweaks across a round trip', () => {
    useEditorStore.getState().setWorkspace('color')
    useEditorStore.getState().setColorScopesOpen(false)
    useEditorStore.getState().setClipInspectorTab('audio')

    useEditorStore.getState().setWorkspace('edit')
    useEditorStore.getState().setWorkspace('color')

    const state = useEditorStore.getState()
    expect(state.colorScopesOpen).toBe(false)
    expect(state.clipInspectorTab).toBe('audio')
  })

  it('persists workspace layout tweaks without requiring a workspace switch', () => {
    useEditorStore.getState().setWorkspace('color')
    useEditorStore.getState().setActiveTab('ai')
    useEditorStore.getState().setClipInspectorTab('audio')
    useEditorStore.getState().setColorScopesOpen(false)
    useEditorStore.getState().togglePropertiesFullColumn()

    const raw = localStorage.getItem('editor:workspaceLayout:color')
    expect(raw).not.toBeNull()
    expect(JSON.parse(raw ?? '{}')).toEqual({
      activeTab: 'ai',
      clipInspectorTab: 'audio',
      colorScopesOpen: false,
      propertiesFullColumn: false,
      panelPosition: 'bottom',
    })
  })

  it('remembers panel position independently for each workspace', () => {
    useEditorStore.getState().setPanelPosition('right')
    useEditorStore.getState().setWorkspace('motion')
    expect(useEditorStore.getState().panelPosition).toBe('bottom')
    useEditorStore.getState().setPanelPosition('left')
    useEditorStore.getState().setWorkspace('edit')
    expect(useEditorStore.getState().panelPosition).toBe('right')
    useEditorStore.getState().setWorkspace('motion')
    expect(useEditorStore.getState().panelPosition).toBe('left')
  })

  it('resets the active workspace layout and its saved split sizes', () => {
    useEditorStore.getState().setPanelPosition('right')
    localStorage.setItem('react-resizable-panels:editor:panels:edit:right', 'saved')
    localStorage.setItem('react-resizable-panels:editor:panels:motion:right', 'other workspace')
    useEditorStore.getState().setLayoutEditing(true)
    useEditorStore.getState().resetPanelLayout()
    expect(useEditorStore.getState().panelPosition).toBe('bottom')
    expect(useEditorStore.getState().layoutEditing).toBe(false)
    expect(localStorage.getItem('react-resizable-panels:editor:panels:edit:right')).toBeNull()
    expect(localStorage.getItem('react-resizable-panels:editor:panels:motion:right')).toBe(
      'other workspace',
    )
  })

  it('ignores setWorkspace for the active workspace', () => {
    const currentState = useEditorStore.getState()
    useEditorStore.getState().setWorkspace('edit')
    expect(useEditorStore.getState()).toBe(currentState)
  })

  it('stops transient preview playback before switching workspaces', () => {
    usePlaybackStore.setState({ isPlaying: true, previewFrame: 42, previewItemId: 'clip-1' })

    useEditorStore.getState().setWorkspace('color')

    expect(usePlaybackStore.getState().isPlaying).toBe(false)
    expect(usePlaybackStore.getState().previewFrame).toBeNull()
    expect(usePlaybackStore.getState().previewItemId).toBeNull()
  })

  it('toggles linked selection', () => {
    expect(useEditorStore.getState().linkedSelectionEnabled).toBe(true)

    useEditorStore.getState().setLinkedSelectionEnabled(false)
    expect(useEditorStore.getState().linkedSelectionEnabled).toBe(false)

    useEditorStore.getState().toggleLinkedSelectionEnabled()
    expect(useEditorStore.getState().linkedSelectionEnabled).toBe(true)
  })

  it('stores independent source patch destination tracks', () => {
    useEditorStore.getState().setSourcePatchVideoTrackId('track-v4')
    useEditorStore.getState().setSourcePatchAudioTrackId('track-a1')

    expect(useEditorStore.getState().sourcePatchVideoTrackId).toBe('track-v4')
    expect(useEditorStore.getState().sourcePatchAudioTrackId).toBe('track-a1')
  })

  it('directly sets left/right sidebar open state', () => {
    useEditorStore.getState().setLeftSidebarOpen(false)
    expect(useEditorStore.getState().leftSidebarOpen).toBe(false)

    useEditorStore.getState().setRightSidebarOpen(false)
    expect(useEditorStore.getState().rightSidebarOpen).toBe(false)
  })

  it('reclamps sidebar widths when syncing sidebar layout', () => {
    const compactLayout = getEditorLayout('compact')
    const compactLeftMaxWidth = getLeftEditorSidebarBounds(compactLayout).maxWidth

    useEditorStore.getState().setSidebarWidth(compactLeftMaxWidth + 100)
    useEditorStore.getState().setRightSidebarWidth(480)
    useEditorStore.getState().syncSidebarLayout(compactLayout)

    expect(useEditorStore.getState().sidebarWidth).toBe(compactLeftMaxWidth)
    expect(useEditorStore.getState().rightSidebarWidth).toBe(compactLayout.rightSidebarMaxWidth)
  })
})
