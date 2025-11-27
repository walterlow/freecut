/**
 * Centralized keyboard shortcut configuration
 *
 * Uses 'mod' for cross-platform Cmd (Mac) / Ctrl (Windows/Linux) handling
 * react-hotkeys-hook automatically handles this translation
 */

export const HOTKEYS = {
  // Playback controls
  PLAY_PAUSE: 'space',
  PREVIOUS_FRAME: 'left',
  NEXT_FRAME: 'right',
  GO_TO_START: 'home',
  GO_TO_END: 'end',
  NEXT_EDGE: 'down',
  PREVIOUS_EDGE: 'up',

  // Timeline editing
  SPLIT_ITEM: 'c',
  JOIN_ITEMS: 'j',
  DELETE_SELECTED: 'delete',
  DELETE_SELECTED_ALT: 'backspace',
  RIPPLE_DELETE: 'mod+delete',
  RIPPLE_DELETE_ALT: 'mod+backspace',

  // History
  UNDO: 'mod+z',
  REDO: 'mod+y',

  // Zoom
  ZOOM_IN: 'mod+equals',
  ZOOM_IN_ALT: 'equals',
  ZOOM_OUT: 'mod+minus',
  ZOOM_OUT_ALT: 'minus',
  ZOOM_RESET: 'mod+0',

  // Selection
  SELECT_ALL: 'mod+a',
  DESELECT_ALL: 'escape',

  // Clipboard
  COPY: 'mod+c',
  PASTE: 'mod+v',
  DUPLICATE: 'mod+d',

  // Tools
  SELECTION_TOOL: 'v',
  RAZOR_TOOL: 'c',
  RATE_STRETCH_TOOL: 'r',
  TEXT_TOOL: 't',

  // Project
  SAVE: 'mod+s',
  EXPORT: 'mod+e',
  NEW_PROJECT: 'mod+n',

  // UI
  TOGGLE_SIDEBAR: 'tab',
  FULLSCREEN_PREVIEW: 'f',
  TOGGLE_TIMELINE_ZOOM: '`',
  TOGGLE_SNAP: 's',

  // Markers
  ADD_MARKER: 'm',
  PREVIOUS_MARKER: '[',
  NEXT_MARKER: ']',
} as const;

export type HotkeyKey = keyof typeof HOTKEYS;

/**
 * Human-readable descriptions for keyboard shortcuts
 * Used for tooltips, help dialogs, and documentation
 */
export const HOTKEY_DESCRIPTIONS: Record<HotkeyKey, string> = {
  // Playback
  PLAY_PAUSE: 'Play/Pause',
  PREVIOUS_FRAME: 'Previous frame',
  NEXT_FRAME: 'Next frame',
  GO_TO_START: 'Go to start',
  GO_TO_END: 'Go to end',
  NEXT_EDGE: 'Next clip edge',
  PREVIOUS_EDGE: 'Previous clip edge',

  // Timeline editing
  SPLIT_ITEM: 'Split item at playhead',
  JOIN_ITEMS: 'Join selected clips',
  DELETE_SELECTED: 'Delete selected items',
  DELETE_SELECTED_ALT: 'Delete selected items (alternative)',
  RIPPLE_DELETE: 'Ripple delete selected items',
  RIPPLE_DELETE_ALT: 'Ripple delete selected items (alternative)',

  // History
  UNDO: 'Undo',
  REDO: 'Redo',

  // Zoom
  ZOOM_IN: 'Zoom in',
  ZOOM_IN_ALT: 'Zoom in (alternative)',
  ZOOM_OUT: 'Zoom out',
  ZOOM_OUT_ALT: 'Zoom out (alternative)',
  ZOOM_RESET: 'Reset zoom to 100%',

  // Selection
  SELECT_ALL: 'Select all items',
  DESELECT_ALL: 'Deselect all',

  // Clipboard
  COPY: 'Copy selected items',
  PASTE: 'Paste items',
  DUPLICATE: 'Duplicate selected items',

  // Tools
  SELECTION_TOOL: 'Selection tool',
  RAZOR_TOOL: 'Razor/Cut tool',
  RATE_STRETCH_TOOL: 'Rate stretch tool',
  TEXT_TOOL: 'Text tool',

  // Project
  SAVE: 'Save project',
  EXPORT: 'Export video',
  NEW_PROJECT: 'New project',

  // UI
  TOGGLE_SIDEBAR: 'Toggle sidebar',
  FULLSCREEN_PREVIEW: 'Fullscreen preview',
  TOGGLE_TIMELINE_ZOOM: 'Toggle timeline zoom',
  TOGGLE_SNAP: 'Toggle snap',

  // Markers
  ADD_MARKER: 'Add marker at playhead',
  PREVIOUS_MARKER: 'Jump to previous marker',
  NEXT_MARKER: 'Jump to next marker',
};

/**
 * Options for react-hotkeys-hook
 * Prevents shortcuts from firing in input fields
 */
export const HOTKEY_OPTIONS = {
  enableOnFormTags: false, // Disable shortcuts when typing in inputs
  preventDefault: true, // Prevent default browser behavior
} as const;
