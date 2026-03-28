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
    sidebarDefaultWidth: 320,
    sidebarMinWidth: 320,
    sidebarMaxWidth: 500,
    sidebarRevealToggleHeight: 80,
    previewPadding: 48,
    previewSplitHeaderHeight: 36,
    previewControlsHeight: 60,
    previewControlButtonSize: 32,
    timelineDefaultSize: 30,
    timelineMinSize: 15,
    timelineMaxSize: 80,
    graphPanelSizeIncrease: 12,
    timelineHeaderHeight: 44,
    timelineTracksHeaderHeight: 44,
    timelineRulerHeight: 44,
    timelineSidebarWidth: 192,
    timelineTrackHeight: 80,
    timelineClipLabelRowHeight: 18,
    timelineVideoWaveformHeight: 30,
  },
  compact: {
    toolbarHeight: 48,
    sidebarRailWidth: 44,
    sidebarHeaderHeight: 36,
    sidebarDefaultWidth: 288,
    sidebarMinWidth: 280,
    sidebarMaxWidth: 420,
    sidebarRevealToggleHeight: 72,
    previewPadding: 32,
    previewSplitHeaderHeight: 32,
    previewControlsHeight: 48,
    previewControlButtonSize: 30,
    timelineDefaultSize: 28,
    timelineMinSize: 14,
    timelineMaxSize: 80,
    graphPanelSizeIncrease: 10,
    timelineHeaderHeight: 40,
    timelineTracksHeaderHeight: 40,
    timelineRulerHeight: 40,
    timelineSidebarWidth: 176,
    timelineTrackHeight: 72,
    timelineClipLabelRowHeight: 16,
    timelineVideoWaveformHeight: 24,
  },
} as const;

export type EditorDensityPresetName = keyof typeof EDITOR_DENSITY_PRESETS;
export type EditorLayout = (typeof EDITOR_DENSITY_PRESETS)[EditorDensityPresetName];

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
  sidebarRevealToggleHeight: '--editor-sidebar-reveal-toggle-height',
  previewPadding: '--editor-preview-padding',
  previewSplitHeaderHeight: '--editor-preview-split-header-height',
  previewControlsHeight: '--editor-preview-controls-height',
  previewControlButtonSize: '--editor-preview-control-button-size',
  timelineHeaderHeight: '--editor-timeline-header-height',
  timelineTracksHeaderHeight: '--editor-timeline-tracks-header-height',
  timelineRulerHeight: '--editor-timeline-ruler-height',
  timelineSidebarWidth: '--editor-timeline-sidebar-width',
  timelineTrackHeight: '--editor-timeline-track-height',
  timelineClipLabelRowHeight: '--editor-timeline-clip-label-row-height',
  timelineVideoWaveformHeight: '--editor-timeline-video-waveform-height',
} as const;

export const EDITOR_LAYOUT_CSS_VALUES = {
  toolbarHeight: `var(${EDITOR_LAYOUT_CSS_VAR_NAMES.toolbarHeight})`,
  sidebarRailWidth: `var(${EDITOR_LAYOUT_CSS_VAR_NAMES.sidebarRailWidth})`,
  sidebarHeaderHeight: `var(${EDITOR_LAYOUT_CSS_VAR_NAMES.sidebarHeaderHeight})`,
  sidebarRevealToggleHeight: `var(${EDITOR_LAYOUT_CSS_VAR_NAMES.sidebarRevealToggleHeight})`,
  previewPadding: `var(${EDITOR_LAYOUT_CSS_VAR_NAMES.previewPadding})`,
  previewSplitHeaderHeight: `var(${EDITOR_LAYOUT_CSS_VAR_NAMES.previewSplitHeaderHeight})`,
  previewControlsHeight: `var(${EDITOR_LAYOUT_CSS_VAR_NAMES.previewControlsHeight})`,
  previewControlButtonSize: `var(${EDITOR_LAYOUT_CSS_VAR_NAMES.previewControlButtonSize})`,
  timelineHeaderHeight: `var(${EDITOR_LAYOUT_CSS_VAR_NAMES.timelineHeaderHeight})`,
  timelineTracksHeaderHeight: `var(${EDITOR_LAYOUT_CSS_VAR_NAMES.timelineTracksHeaderHeight})`,
  timelineRulerHeight: `var(${EDITOR_LAYOUT_CSS_VAR_NAMES.timelineRulerHeight})`,
  timelineSidebarWidth: `var(${EDITOR_LAYOUT_CSS_VAR_NAMES.timelineSidebarWidth})`,
  timelineTrackHeight: `var(${EDITOR_LAYOUT_CSS_VAR_NAMES.timelineTrackHeight})`,
  timelineClipLabelRowHeight: `var(${EDITOR_LAYOUT_CSS_VAR_NAMES.timelineClipLabelRowHeight})`,
  timelineVideoWaveformHeight: `var(${EDITOR_LAYOUT_CSS_VAR_NAMES.timelineVideoWaveformHeight})`,
} as const;

export function getEditorLayoutCssVars(layout = EDITOR_LAYOUT): Record<string, string> {
  return {
    [EDITOR_LAYOUT_CSS_VAR_NAMES.toolbarHeight]: `${layout.toolbarHeight}px`,
    [EDITOR_LAYOUT_CSS_VAR_NAMES.sidebarRailWidth]: `${layout.sidebarRailWidth}px`,
    [EDITOR_LAYOUT_CSS_VAR_NAMES.sidebarHeaderHeight]: `${layout.sidebarHeaderHeight}px`,
    [EDITOR_LAYOUT_CSS_VAR_NAMES.sidebarRevealToggleHeight]: `${layout.sidebarRevealToggleHeight}px`,
    [EDITOR_LAYOUT_CSS_VAR_NAMES.previewPadding]: `${layout.previewPadding}px`,
    [EDITOR_LAYOUT_CSS_VAR_NAMES.previewSplitHeaderHeight]: `${layout.previewSplitHeaderHeight}px`,
    [EDITOR_LAYOUT_CSS_VAR_NAMES.previewControlsHeight]: `${layout.previewControlsHeight}px`,
    [EDITOR_LAYOUT_CSS_VAR_NAMES.previewControlButtonSize]: `${layout.previewControlButtonSize}px`,
    [EDITOR_LAYOUT_CSS_VAR_NAMES.timelineHeaderHeight]: `${layout.timelineHeaderHeight}px`,
    [EDITOR_LAYOUT_CSS_VAR_NAMES.timelineTracksHeaderHeight]: `${layout.timelineTracksHeaderHeight}px`,
    [EDITOR_LAYOUT_CSS_VAR_NAMES.timelineRulerHeight]: `${layout.timelineRulerHeight}px`,
    [EDITOR_LAYOUT_CSS_VAR_NAMES.timelineSidebarWidth]: `${layout.timelineSidebarWidth}px`,
    [EDITOR_LAYOUT_CSS_VAR_NAMES.timelineTrackHeight]: `${layout.timelineTrackHeight}px`,
    [EDITOR_LAYOUT_CSS_VAR_NAMES.timelineClipLabelRowHeight]: `${layout.timelineClipLabelRowHeight}px`,
    [EDITOR_LAYOUT_CSS_VAR_NAMES.timelineVideoWaveformHeight]: `${layout.timelineVideoWaveformHeight}px`,
  };
}

export const EDITOR_LAYOUT_CSS_VARS = getEditorLayoutCssVars();

export function clampEditorSidebarWidth(
  width: number,
  layoutOrPreset: EditorLayout | EditorDensityPresetName = EDITOR_LAYOUT
): number {
  const layout = typeof layoutOrPreset === 'string'
    ? getEditorLayout(layoutOrPreset)
    : layoutOrPreset;

  return Math.min(
    layout.sidebarMaxWidth,
    Math.max(layout.sidebarMinWidth, width)
  );
}
