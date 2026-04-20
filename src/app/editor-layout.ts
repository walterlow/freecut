/**
 * Editor density presets.
 *
 * `default` approximates the roomier original shell.
 * `compact` is tuned to keep more of the editor visible on a 1920x1080 display.
 *
 * Prefer changing presets here before editing one-off component sizes.
 */
export const EDITOR_DENSITY_PRESETS = {
  default: {
    toolbarHeight: 56,
    sidebarRailWidth: 48,
    sidebarHeaderHeight: 40,
    sidebarHeaderButtonSize: 20,
    toolbarButtonSize: 20,
    leftSidebarDefaultWidth: 360,
    leftSidebarMinWidth: 240,
    leftSidebarMaxWidth: 680,
    rightSidebarDefaultWidth: 320,
    rightSidebarMinWidth: 320,
    rightSidebarMaxWidth: 640,
    sidebarRevealToggleHeight: 80,
    previewPadding: 48,
    previewSplitHeaderHeight: 36,
    previewControlsHeight: 36,
    previewControlButtonSize: 32,
    timelineDefaultSize: 30,
    timelineMinSize: 15,
    timelineMaxSize: 80,
    graphPanelSizeIncrease: 12,
    timelineHeaderHeight: 44,
    timelineTracksHeaderHeight: 44,
    timelineRulerHeight: 44,
    timelineSidebarWidth: 192,
    timelineMeterWidth: 92,
    timelineMixerWidth: 280,
    timelineTrackHeight: 100,
    timelineClipLabelRowHeight: 24,
    timelineWaveformRowHeight: 30,
  },
  compact: {
    toolbarHeight: 48,
    sidebarRailWidth: 44,
    sidebarHeaderHeight: 36,
    sidebarHeaderButtonSize: 20,
    toolbarButtonSize: 20,
    leftSidebarDefaultWidth: 320,
    leftSidebarMinWidth: 240,
    leftSidebarMaxWidth: 560,
    rightSidebarDefaultWidth: 288,
    rightSidebarMinWidth: 280,
    rightSidebarMaxWidth: 420,
    sidebarRevealToggleHeight: 72,
    previewPadding: 32,
    previewSplitHeaderHeight: 32,
    previewControlsHeight: 32,
    previewControlButtonSize: 30,
    timelineDefaultSize: 28,
    timelineMinSize: 14,
    timelineMaxSize: 80,
    graphPanelSizeIncrease: 10,
    timelineHeaderHeight: 40,
    timelineTracksHeaderHeight: 40,
    timelineRulerHeight: 40,
    timelineSidebarWidth: 176,
    timelineMeterWidth: 84,
    timelineMixerWidth: 260,
    timelineTrackHeight: 100,
    timelineClipLabelRowHeight: 24,
    timelineWaveformRowHeight: 24,
  },
} as const;

export type EditorDensityPresetName = keyof typeof EDITOR_DENSITY_PRESETS;
export type EditorLayout = (typeof EDITOR_DENSITY_PRESETS)[EditorDensityPresetName];
type LeftSidebarLayoutBounds = Pick<EditorLayout, 'leftSidebarMinWidth' | 'leftSidebarMaxWidth'>;
type RightSidebarLayoutBounds = Pick<EditorLayout, 'rightSidebarMinWidth' | 'rightSidebarMaxWidth'>;

export const DEFAULT_EDITOR_DENSITY_PRESET: EditorDensityPresetName = 'compact';

export const EDITOR_DENSITY_OPTIONS = [
  { value: 'compact', label: 'Compact' },
  { value: 'default', label: 'Default' },
] as const satisfies ReadonlyArray<{
  value: EditorDensityPresetName;
  label: string;
}>;

export function getEditorLayout(
  preset: EditorDensityPresetName = DEFAULT_EDITOR_DENSITY_PRESET
): EditorLayout {
  return EDITOR_DENSITY_PRESETS[preset];
}

export const EDITOR_LAYOUT = getEditorLayout();

const EDITOR_LAYOUT_CSS_VAR_NAMES = {
  toolbarHeight: '--editor-toolbar-height',
  sidebarRailWidth: '--editor-sidebar-rail-width',
  sidebarHeaderHeight: '--editor-sidebar-header-height',
  sidebarHeaderButtonSize: '--editor-sidebar-header-button-size',
  toolbarButtonSize: '--editor-toolbar-button-size',
  sidebarRevealToggleHeight: '--editor-sidebar-reveal-toggle-height',
  previewPadding: '--editor-preview-padding',
  previewSplitHeaderHeight: '--editor-preview-split-header-height',
  previewControlsHeight: '--editor-preview-controls-height',
  previewControlButtonSize: '--editor-preview-control-button-size',
  timelineHeaderHeight: '--editor-timeline-header-height',
  timelineTracksHeaderHeight: '--editor-timeline-tracks-header-height',
  timelineRulerHeight: '--editor-timeline-ruler-height',
  timelineSidebarWidth: '--editor-timeline-sidebar-width',
  timelineMeterWidth: '--editor-timeline-meter-width',
  timelineMixerWidth: '--editor-timeline-mixer-width',
  timelineTrackHeight: '--editor-timeline-track-height',
  timelineClipLabelRowHeight: '--editor-timeline-clip-label-row-height',
  timelineWaveformRowHeight: '--editor-timeline-waveform-row-height',
} as const;

export const EDITOR_LAYOUT_CSS_VALUES = {
  toolbarHeight: `var(${EDITOR_LAYOUT_CSS_VAR_NAMES.toolbarHeight})`,
  sidebarRailWidth: `var(${EDITOR_LAYOUT_CSS_VAR_NAMES.sidebarRailWidth})`,
  sidebarHeaderHeight: `var(${EDITOR_LAYOUT_CSS_VAR_NAMES.sidebarHeaderHeight})`,
  sidebarHeaderButtonSize: `var(${EDITOR_LAYOUT_CSS_VAR_NAMES.sidebarHeaderButtonSize})`,
  toolbarButtonSize: `var(${EDITOR_LAYOUT_CSS_VAR_NAMES.toolbarButtonSize})`,
  sidebarRevealToggleHeight: `var(${EDITOR_LAYOUT_CSS_VAR_NAMES.sidebarRevealToggleHeight})`,
  previewPadding: `var(${EDITOR_LAYOUT_CSS_VAR_NAMES.previewPadding})`,
  previewSplitHeaderHeight: `var(${EDITOR_LAYOUT_CSS_VAR_NAMES.previewSplitHeaderHeight})`,
  previewControlsHeight: `var(${EDITOR_LAYOUT_CSS_VAR_NAMES.previewControlsHeight})`,
  previewControlButtonSize: `var(${EDITOR_LAYOUT_CSS_VAR_NAMES.previewControlButtonSize})`,
  timelineHeaderHeight: `var(${EDITOR_LAYOUT_CSS_VAR_NAMES.timelineHeaderHeight})`,
  timelineTracksHeaderHeight: `var(${EDITOR_LAYOUT_CSS_VAR_NAMES.timelineTracksHeaderHeight})`,
  timelineRulerHeight: `var(${EDITOR_LAYOUT_CSS_VAR_NAMES.timelineRulerHeight})`,
  timelineSidebarWidth: `var(${EDITOR_LAYOUT_CSS_VAR_NAMES.timelineSidebarWidth})`,
  timelineMeterWidth: `var(${EDITOR_LAYOUT_CSS_VAR_NAMES.timelineMeterWidth})`,
  timelineMixerWidth: `var(${EDITOR_LAYOUT_CSS_VAR_NAMES.timelineMixerWidth})`,
  timelineTrackHeight: `var(${EDITOR_LAYOUT_CSS_VAR_NAMES.timelineTrackHeight})`,
  timelineClipLabelRowHeight: `var(${EDITOR_LAYOUT_CSS_VAR_NAMES.timelineClipLabelRowHeight})`,
  timelineWaveformRowHeight: `var(${EDITOR_LAYOUT_CSS_VAR_NAMES.timelineWaveformRowHeight})`,
} as const;

export function getEditorLayoutCssVars(layout = EDITOR_LAYOUT): Record<string, string> {
  return {
    [EDITOR_LAYOUT_CSS_VAR_NAMES.toolbarHeight]: `${layout.toolbarHeight}px`,
    [EDITOR_LAYOUT_CSS_VAR_NAMES.sidebarRailWidth]: `${layout.sidebarRailWidth}px`,
    [EDITOR_LAYOUT_CSS_VAR_NAMES.sidebarHeaderHeight]: `${layout.sidebarHeaderHeight}px`,
    [EDITOR_LAYOUT_CSS_VAR_NAMES.sidebarHeaderButtonSize]: `${layout.sidebarHeaderButtonSize}px`,
    [EDITOR_LAYOUT_CSS_VAR_NAMES.toolbarButtonSize]: `${layout.toolbarButtonSize}px`,
    [EDITOR_LAYOUT_CSS_VAR_NAMES.sidebarRevealToggleHeight]: `${layout.sidebarRevealToggleHeight}px`,
    [EDITOR_LAYOUT_CSS_VAR_NAMES.previewPadding]: `${layout.previewPadding}px`,
    [EDITOR_LAYOUT_CSS_VAR_NAMES.previewSplitHeaderHeight]: `${layout.previewSplitHeaderHeight}px`,
    [EDITOR_LAYOUT_CSS_VAR_NAMES.previewControlsHeight]: `${layout.previewControlsHeight}px`,
    [EDITOR_LAYOUT_CSS_VAR_NAMES.previewControlButtonSize]: `${layout.previewControlButtonSize}px`,
    [EDITOR_LAYOUT_CSS_VAR_NAMES.timelineHeaderHeight]: `${layout.timelineHeaderHeight}px`,
    [EDITOR_LAYOUT_CSS_VAR_NAMES.timelineTracksHeaderHeight]: `${layout.timelineTracksHeaderHeight}px`,
    [EDITOR_LAYOUT_CSS_VAR_NAMES.timelineRulerHeight]: `${layout.timelineRulerHeight}px`,
    [EDITOR_LAYOUT_CSS_VAR_NAMES.timelineSidebarWidth]: `${layout.timelineSidebarWidth}px`,
    [EDITOR_LAYOUT_CSS_VAR_NAMES.timelineMeterWidth]: `${layout.timelineMeterWidth}px`,
    [EDITOR_LAYOUT_CSS_VAR_NAMES.timelineMixerWidth]: `${layout.timelineMixerWidth}px`,
    [EDITOR_LAYOUT_CSS_VAR_NAMES.timelineTrackHeight]: `${layout.timelineTrackHeight}px`,
    [EDITOR_LAYOUT_CSS_VAR_NAMES.timelineClipLabelRowHeight]: `${layout.timelineClipLabelRowHeight}px`,
    [EDITOR_LAYOUT_CSS_VAR_NAMES.timelineWaveformRowHeight]: `${layout.timelineWaveformRowHeight}px`,
  };
}

export const EDITOR_LAYOUT_CSS_VARS = getEditorLayoutCssVars();

const LEFT_SIDEBAR_MAX_VIEWPORT_RATIO = 0.45;

function clampSidebarWidth(width: number, bounds: { minWidth: number; maxWidth: number }): number {
  return Math.min(bounds.maxWidth, Math.max(bounds.minWidth, width));
}

function getViewportWidth(): number | null {
  if (typeof window !== 'undefined' && Number.isFinite(window.innerWidth) && window.innerWidth > 0) {
    return window.innerWidth;
  }

  if (typeof document !== 'undefined') {
    const documentWidth = document.documentElement?.clientWidth;
    if (Number.isFinite(documentWidth) && documentWidth > 0) {
      return documentWidth;
    }
  }

  return null;
}

export function getLeftEditorSidebarBounds(
  layoutOrPreset: EditorLayout | LeftSidebarLayoutBounds | EditorDensityPresetName = EDITOR_LAYOUT
): { minWidth: number; maxWidth: number } {
  const layout = typeof layoutOrPreset === 'string'
    ? getEditorLayout(layoutOrPreset)
    : layoutOrPreset;
  const viewportWidth = getViewportWidth();
  const viewportMaxWidth = viewportWidth === null
    ? layout.leftSidebarMaxWidth
    : Math.floor(viewportWidth * LEFT_SIDEBAR_MAX_VIEWPORT_RATIO);

  return {
    minWidth: layout.leftSidebarMinWidth,
    maxWidth: Math.max(layout.leftSidebarMinWidth, viewportMaxWidth),
  };
}

export function getRightEditorSidebarBounds(
  layoutOrPreset: EditorLayout | RightSidebarLayoutBounds | EditorDensityPresetName = EDITOR_LAYOUT
): { minWidth: number; maxWidth: number } {
  const layout = typeof layoutOrPreset === 'string'
    ? getEditorLayout(layoutOrPreset)
    : layoutOrPreset;

  return {
    minWidth: layout.rightSidebarMinWidth,
    maxWidth: layout.rightSidebarMaxWidth,
  };
}

export function clampLeftEditorSidebarWidth(
  width: number,
  layoutOrPreset: EditorLayout | EditorDensityPresetName = EDITOR_LAYOUT
): number {
  return clampSidebarWidth(width, getLeftEditorSidebarBounds(layoutOrPreset));
}

export function clampRightEditorSidebarWidth(
  width: number,
  layoutOrPreset: EditorLayout | EditorDensityPresetName = EDITOR_LAYOUT
): number {
  return clampSidebarWidth(width, getRightEditorSidebarBounds(layoutOrPreset));
}
