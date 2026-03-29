import { describe, expect, it, beforeEach } from 'vitest';
import { useEditorStore } from './editor-store';
import {
  DEFAULT_EDITOR_DENSITY_PRESET,
  getEditorLayout,
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
      activeTab: 'media',
      clipInspectorTab: 'transform',
      sidebarWidth: editorLayout.sidebarDefaultWidth,
      rightSidebarWidth: editorLayout.sidebarDefaultWidth,
      timelineHeight: 250,
      sourcePreviewMediaId: null,
      colorScopesOpen: false,
    });
  });

  it('has correct initial state', () => {
    const state = useEditorStore.getState();
    expect(state.activePanel).toBe(null);
    expect(state.leftSidebarOpen).toBe(true);
    expect(state.rightSidebarOpen).toBe(true);
    expect(state.activeTab).toBe('media');
    expect(state.clipInspectorTab).toBe('transform');
    expect(state.sourcePreviewMediaId).toBe(null);
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

  it('sets active tab', () => {
    useEditorStore.getState().setActiveTab('effects');
    expect(useEditorStore.getState().activeTab).toBe('effects');

    useEditorStore.getState().setActiveTab('transitions');
    expect(useEditorStore.getState().activeTab).toBe('transitions');
  });

  it('sets clip inspector tab', () => {
    useEditorStore.getState().setClipInspectorTab('effects');
    expect(useEditorStore.getState().clipInspectorTab).toBe('effects');

    useEditorStore.getState().setClipInspectorTab('media');
    expect(useEditorStore.getState().clipInspectorTab).toBe('media');
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
    useEditorStore.getState().setSourcePreviewMediaId('media-123');
    expect(useEditorStore.getState().sourcePreviewMediaId).toBe('media-123');

    useEditorStore.getState().setSourcePreviewMediaId(null);
    expect(useEditorStore.getState().sourcePreviewMediaId).toBe(null);
  });

  it('toggles the color scopes monitor', () => {
    expect(useEditorStore.getState().colorScopesOpen).toBe(false);

    useEditorStore.getState().toggleColorScopesOpen();
    expect(useEditorStore.getState().colorScopesOpen).toBe(true);

    useEditorStore.getState().setColorScopesOpen(false);
    expect(useEditorStore.getState().colorScopesOpen).toBe(false);
  });

  it('directly sets left/right sidebar open state', () => {
    useEditorStore.getState().setLeftSidebarOpen(false);
    expect(useEditorStore.getState().leftSidebarOpen).toBe(false);

    useEditorStore.getState().setRightSidebarOpen(false);
    expect(useEditorStore.getState().rightSidebarOpen).toBe(false);
  });

  it('reclamps sidebar widths when syncing sidebar layout', () => {
    useEditorStore.getState().setSidebarWidth(480);
    useEditorStore.getState().setRightSidebarWidth(480);

    const compactLayout = getEditorLayout('compact');
    useEditorStore.getState().syncSidebarLayout(compactLayout);

    expect(useEditorStore.getState().sidebarWidth).toBe(compactLayout.sidebarMaxWidth);
    expect(useEditorStore.getState().rightSidebarWidth).toBe(compactLayout.sidebarMaxWidth);
  });
});
