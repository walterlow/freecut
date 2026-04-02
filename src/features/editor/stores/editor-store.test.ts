import { describe, expect, it, beforeEach } from 'vitest';
import { useEditorStore } from './editor-store';
import {
  DEFAULT_EDITOR_DENSITY_PRESET,
  getEditorLayout,
  getLeftEditorSidebarBounds,
} from '@/shared/ui/editor-layout';
import { useSettingsStore } from '@/features/editor/deps/settings';

describe('editor-store', () => {
  beforeEach(() => {
    useSettingsStore.getState().setSetting('editorDensity', DEFAULT_EDITOR_DENSITY_PRESET);
    const editorLayout = getEditorLayout(DEFAULT_EDITOR_DENSITY_PRESET);

    // Reset store to defaults between tests
    useEditorStore.setState({
      activePanel: null,
      leftSidebarOpen: true,
      rightSidebarOpen: true,
      keyframeEditorOpen: false,
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
      linkedSelectionEnabled: true,
      colorScopesOpen: false,
    });
  });

  it('has correct initial state', () => {
    const state = useEditorStore.getState();
    expect(state.activePanel).toBe(null);
    expect(state.leftSidebarOpen).toBe(true);
    expect(state.rightSidebarOpen).toBe(true);
    expect(state.keyframeEditorOpen).toBe(false);
    expect(state.activeTab).toBe('media');
    expect(state.clipInspectorTab).toBe('video');
    expect(state.sourcePreviewMediaId).toBe(null);
    expect(state.mediaSkimPreviewMediaId).toBe(null);
    expect(state.mediaSkimPreviewFrame).toBe(null);
    expect(state.compoundClipSkimPreviewCompositionId).toBe(null);
    expect(state.compoundClipSkimPreviewFrame).toBe(null);
    expect(state.linkedSelectionEnabled).toBe(true);
    expect(state.colorScopesOpen).toBe(false);
  });

  it('sets active panel', () => {
    useEditorStore.getState().setActivePanel('media');
    expect(useEditorStore.getState().activePanel).toBe('media');

    useEditorStore.getState().setActivePanel(null);
    expect(useEditorStore.getState().activePanel).toBe(null);
  });

  it('toggles left sidebar', () => {
    expect(useEditorStore.getState().leftSidebarOpen).toBe(true);

    useEditorStore.getState().toggleLeftSidebar();
    expect(useEditorStore.getState().leftSidebarOpen).toBe(false);

    useEditorStore.getState().toggleLeftSidebar();
    expect(useEditorStore.getState().leftSidebarOpen).toBe(true);
  });

  it('toggles right sidebar', () => {
    expect(useEditorStore.getState().rightSidebarOpen).toBe(true);

    useEditorStore.getState().toggleRightSidebar();
    expect(useEditorStore.getState().rightSidebarOpen).toBe(false);

    useEditorStore.getState().toggleRightSidebar();
    expect(useEditorStore.getState().rightSidebarOpen).toBe(true);
  });

  it('opens the keyframe editor and reveals the left sidebar', () => {
    useEditorStore.getState().setLeftSidebarOpen(false);
    expect(useEditorStore.getState().keyframeEditorOpen).toBe(false);

    useEditorStore.getState().toggleKeyframeEditorOpen();

    expect(useEditorStore.getState().keyframeEditorOpen).toBe(true);
    expect(useEditorStore.getState().leftSidebarOpen).toBe(true);

    useEditorStore.getState().setKeyframeEditorOpen(false);
    expect(useEditorStore.getState().keyframeEditorOpen).toBe(false);
  });

  it('sets active tab', () => {
    useEditorStore.getState().setActiveTab('effects');
    expect(useEditorStore.getState().activeTab).toBe('effects');

    useEditorStore.getState().setActiveTab('transitions');
    expect(useEditorStore.getState().activeTab).toBe('transitions');
  });

  it('sets clip inspector tab', () => {
    useEditorStore.getState().setClipInspectorTab('effects');
    expect(useEditorStore.getState().clipInspectorTab).toBe('effects');

    useEditorStore.getState().setClipInspectorTab('audio');
    expect(useEditorStore.getState().clipInspectorTab).toBe('audio');
  });

  it('sets sidebar widths', () => {
    useEditorStore.getState().setSidebarWidth(400);
    expect(useEditorStore.getState().sidebarWidth).toBe(400);

    useEditorStore.getState().setRightSidebarWidth(250);
    expect(useEditorStore.getState().rightSidebarWidth).toBe(250);
  });

  it('sets timeline height', () => {
    useEditorStore.getState().setTimelineHeight(300);
    expect(useEditorStore.getState().timelineHeight).toBe(300);
  });

  it('sets source preview media id', () => {
    useEditorStore.getState().setMediaSkimPreview('media-hover', 12);
    useEditorStore.getState().setSourcePreviewMediaId('media-123');
    expect(useEditorStore.getState().sourcePreviewMediaId).toBe('media-123');
    expect(useEditorStore.getState().mediaSkimPreviewMediaId).toBe(null);
    expect(useEditorStore.getState().mediaSkimPreviewFrame).toBe(null);
    expect(useEditorStore.getState().compoundClipSkimPreviewCompositionId).toBe(null);
    expect(useEditorStore.getState().compoundClipSkimPreviewFrame).toBe(null);

    useEditorStore.getState().setSourcePreviewMediaId(null);
    expect(useEditorStore.getState().sourcePreviewMediaId).toBe(null);
  });

  it('tracks media skim preview state', () => {
    useEditorStore.getState().setMediaSkimPreview('media-123', 45);
    expect(useEditorStore.getState().mediaSkimPreviewMediaId).toBe('media-123');
    expect(useEditorStore.getState().mediaSkimPreviewFrame).toBe(45);

    useEditorStore.getState().clearMediaSkimPreview();
    expect(useEditorStore.getState().mediaSkimPreviewMediaId).toBe(null);
    expect(useEditorStore.getState().mediaSkimPreviewFrame).toBe(null);
  });

  it('tracks compound clip skim preview state', () => {
    useEditorStore.getState().setCompoundClipSkimPreview('composition-123', 18);
    expect(useEditorStore.getState().compoundClipSkimPreviewCompositionId).toBe('composition-123');
    expect(useEditorStore.getState().compoundClipSkimPreviewFrame).toBe(18);
    expect(useEditorStore.getState().mediaSkimPreviewMediaId).toBe(null);
    expect(useEditorStore.getState().mediaSkimPreviewFrame).toBe(null);

    useEditorStore.getState().clearCompoundClipSkimPreview();
    expect(useEditorStore.getState().compoundClipSkimPreviewCompositionId).toBe(null);
    expect(useEditorStore.getState().compoundClipSkimPreviewFrame).toBe(null);
  });

  it('does not publish a new state object when skim preview values are unchanged', () => {
    useEditorStore.getState().setMediaSkimPreview('media-123', 45);
    const currentState = useEditorStore.getState();

    useEditorStore.getState().setMediaSkimPreview('media-123', 45);
    expect(useEditorStore.getState()).toBe(currentState);

    useEditorStore.getState().clearMediaSkimPreview();
    const clearedState = useEditorStore.getState();

    useEditorStore.getState().clearMediaSkimPreview();
    expect(useEditorStore.getState()).toBe(clearedState);

    useEditorStore.getState().setCompoundClipSkimPreview('composition-123', 18);
    const compoundCurrentState = useEditorStore.getState();

    useEditorStore.getState().setCompoundClipSkimPreview('composition-123', 18);
    expect(useEditorStore.getState()).toBe(compoundCurrentState);

    useEditorStore.getState().clearCompoundClipSkimPreview();
    const compoundClearedState = useEditorStore.getState();

    useEditorStore.getState().clearCompoundClipSkimPreview();
    expect(useEditorStore.getState()).toBe(compoundClearedState);
  });

  it('toggles the color scopes monitor', () => {
    expect(useEditorStore.getState().colorScopesOpen).toBe(false);

    useEditorStore.getState().toggleColorScopesOpen();
    expect(useEditorStore.getState().colorScopesOpen).toBe(true);

    useEditorStore.getState().setColorScopesOpen(false);
    expect(useEditorStore.getState().colorScopesOpen).toBe(false);
  });

  it('toggles linked selection', () => {
    expect(useEditorStore.getState().linkedSelectionEnabled).toBe(true);

    useEditorStore.getState().setLinkedSelectionEnabled(false);
    expect(useEditorStore.getState().linkedSelectionEnabled).toBe(false);

    useEditorStore.getState().toggleLinkedSelectionEnabled();
    expect(useEditorStore.getState().linkedSelectionEnabled).toBe(true);
  });

  it('directly sets left/right sidebar open state', () => {
    useEditorStore.getState().setLeftSidebarOpen(false);
    expect(useEditorStore.getState().leftSidebarOpen).toBe(false);

    useEditorStore.getState().setRightSidebarOpen(false);
    expect(useEditorStore.getState().rightSidebarOpen).toBe(false);
  });

  it('reclamps sidebar widths when syncing sidebar layout', () => {
    const compactLayout = getEditorLayout('compact');
    const compactLeftMaxWidth = getLeftEditorSidebarBounds(compactLayout).maxWidth;

    useEditorStore.getState().setSidebarWidth(compactLeftMaxWidth + 100);
    useEditorStore.getState().setRightSidebarWidth(480);
    useEditorStore.getState().syncSidebarLayout(compactLayout);

    expect(useEditorStore.getState().sidebarWidth).toBe(compactLeftMaxWidth);
    expect(useEditorStore.getState().rightSidebarWidth).toBe(compactLayout.rightSidebarMaxWidth);
  });
});
