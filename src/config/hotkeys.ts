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
  NEXT_SNAP_POINT: 'down',
  PREVIOUS_SNAP_POINT: 'up',

  // Timeline editing
  SPLIT_AT_PLAYHEAD: 'alt+c',
  JOIN_ITEMS: 'j',
  DELETE_SELECTED: 'delete',
  DELETE_SELECTED_ALT: 'backspace',
  RIPPLE_DELETE: 'mod+delete',
  RIPPLE_DELETE_ALT: 'mod+backspace',
  FREEZE_FRAME: 'shift+f',

  // History
  UNDO: 'mod+z',
  REDO: 'mod+y',

  // Zoom
  ZOOM_TO_FIT: 'z',
  ZOOM_TO_100: 'shift+z',

  // Clipboard
  COPY: 'mod+c',
  CUT: 'mod+x',
  PASTE: 'mod+v',

  // Tools
  SELECTION_TOOL: 'v',
  RAZOR_TOOL: 'c',
  SPLIT_AT_CURSOR: 'shift+c',
  RATE_STRETCH_TOOL: 'r',
  ROLLING_EDIT_TOOL: 'n',
  RIPPLE_EDIT_TOOL: 'b',
  SLIP_TOOL: 'y',
  SLIDE_TOOL: 'u',

  // Project
  SAVE: 'mod+s',
  EXPORT: 'mod+e',

  // UI
  TOGGLE_SNAP: 's',

  // Markers
  ADD_MARKER: 'm',
  REMOVE_MARKER: 'shift+m',
  PREVIOUS_MARKER: 'bracketleft',
  NEXT_MARKER: 'bracketright',

  // Keyframes
  ADD_KEYFRAME: 'k',
  CLEAR_KEYFRAMES: 'shift+k',
  TOGGLE_KEYFRAME_EDITOR: 'mod+k',
  KEYFRAME_EDITOR_GRAPH: '1',
  KEYFRAME_EDITOR_DOPESHEET: '2',
  KEYFRAME_EDITOR_SPLIT: '3',

  // Track Groups
  GROUP_TRACKS: 'mod+g',
  UNGROUP_TRACKS: 'mod+shift+g',

  // Source Monitor
  MARK_IN: 'i',
  MARK_OUT: 'o',
  CLEAR_IN_OUT: 'alt+x',
  INSERT_EDIT: 'comma',
  OVERWRITE_EDIT: 'period',
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
  NEXT_SNAP_POINT: 'Next snap point',
  PREVIOUS_SNAP_POINT: 'Previous snap point',

  // Timeline editing
  SPLIT_AT_PLAYHEAD: 'Split at playhead',
  JOIN_ITEMS: 'Join selected clips',
  DELETE_SELECTED: 'Delete selected items',
  DELETE_SELECTED_ALT: 'Delete selected items (alternative)',
  RIPPLE_DELETE: 'Ripple delete selected items',
  RIPPLE_DELETE_ALT: 'Ripple delete selected items (alternative)',
  FREEZE_FRAME: 'Insert freeze frame at playhead',

  // History
  UNDO: 'Undo',
  REDO: 'Redo',

  // Zoom
  ZOOM_TO_FIT: 'Zoom to fit all content',
  ZOOM_TO_100: 'Zoom to 100% at cursor or playhead',

  // Clipboard
  COPY: 'Copy selected items',
  CUT: 'Cut selected items',
  PASTE: 'Paste items',

  // Tools
  SELECTION_TOOL: 'Selection tool',
  RAZOR_TOOL: 'Razor tool',
  SPLIT_AT_CURSOR: 'Split at cursor',
  RATE_STRETCH_TOOL: 'Rate stretch tool',
  ROLLING_EDIT_TOOL: 'Rolling edit tool',
  RIPPLE_EDIT_TOOL: 'Ripple edit tool',
  SLIP_TOOL: 'Slip tool',
  SLIDE_TOOL: 'Slide tool',

  // Project
  SAVE: 'Save project',
  EXPORT: 'Export video',

  // UI
  TOGGLE_SNAP: 'Toggle snap',

  // Markers
  ADD_MARKER: 'Add marker at playhead',
  REMOVE_MARKER: 'Remove selected marker',
  PREVIOUS_MARKER: 'Jump to previous marker',
  NEXT_MARKER: 'Jump to next marker',

  // Keyframes
  ADD_KEYFRAME: 'Add keyframe at playhead',
  CLEAR_KEYFRAMES: 'Clear all keyframes from selected items',
  TOGGLE_KEYFRAME_EDITOR: 'Toggle keyframe editor panel',
  KEYFRAME_EDITOR_GRAPH: 'Switch keyframe editor to graph view',
  KEYFRAME_EDITOR_DOPESHEET: 'Switch keyframe editor to dopesheet view',
  KEYFRAME_EDITOR_SPLIT: 'Switch keyframe editor to split view',

  // Track Groups
  GROUP_TRACKS: 'Group selected tracks',
  UNGROUP_TRACKS: 'Ungroup selected tracks',

  // Source Monitor
  MARK_IN: 'Mark In point',
  MARK_OUT: 'Mark Out point',
  CLEAR_IN_OUT: 'Clear In/Out points',
  INSERT_EDIT: 'Insert edit',
  OVERWRITE_EDIT: 'Overwrite edit',
};

/**
 * Options for react-hotkeys-hook
 * Prevents shortcuts from firing in input fields
 */
export const HOTKEY_OPTIONS = {
  enableOnFormTags: false, // Disable shortcuts when typing in inputs
  preventDefault: true, // Prevent default browser behavior
} as const;
