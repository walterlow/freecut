import { describe, expect, it, beforeEach } from 'vitest';
import { useEditorStore } from './editor-store';

describe('editor-store', () => {
  beforeEach(() => {
    // Reset store to defaults between tests
    useEditorStore.setState({
      activePanel: null,
      leftSidebarOpen: true,
      rightSidebarOpen: true,
      activeTab: 'media',
      sidebarWidth: 320,
      rightSidebarWidth: 320,
      timelineHeight: 250,
      sourcePreviewMediaId: null,
    });
  });

  it('has correct initial state', () => {
    const state = useEditorStore.getState();
    expect(state.activePanel).toBe(null);
    expect(state.leftSidebarOpen).toBe(true);
    expect(state.rightSidebarOpen).toBe(true);
    expect(state.activeTab).toBe('media');
    expect(state.sourcePreviewMediaId).toBe(null);
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

  it('directly sets left/right sidebar open state', () => {
    useEditorStore.getState().setLeftSidebarOpen(false);
    expect(useEditorStore.getState().leftSidebarOpen).toBe(false);

    useEditorStore.getState().setRightSidebarOpen(false);
    expect(useEditorStore.getState().rightSidebarOpen).toBe(false);
  });
});
