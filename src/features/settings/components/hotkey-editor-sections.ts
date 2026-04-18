import type { HotkeyKey } from '@/config/hotkeys';

export interface HotkeyEditorItem {
  label: string;
  keys: readonly HotkeyKey[];
}

export interface HotkeyEditorSection {
  title: string;
  blurb: string;
  items: readonly HotkeyEditorItem[];
}

export const HOTKEY_EDITOR_SECTIONS: readonly HotkeyEditorSection[] = [
  {
    title: 'Playback',
    blurb: 'Transport, frame stepping, and timeline jumps.',
    items: [
      { label: 'Play/Pause', keys: ['PLAY_PAUSE'] },
      { label: 'Previous frame', keys: ['PREVIOUS_FRAME'] },
      { label: 'Next frame', keys: ['NEXT_FRAME'] },
      { label: 'Go to start', keys: ['GO_TO_START'] },
      { label: 'Go to end', keys: ['GO_TO_END'] },
      { label: 'Previous snap point', keys: ['PREVIOUS_SNAP_POINT'] },
      { label: 'Next snap point', keys: ['NEXT_SNAP_POINT'] },
    ],
  },
  {
    title: 'Editing',
    blurb: 'Clip edits, delete flows, and precise canvas nudging.',
    items: [
      { label: 'Split at playhead', keys: ['SPLIT_AT_PLAYHEAD', 'SPLIT_AT_PLAYHEAD_ALT'] },
      { label: 'Join selected clips', keys: ['JOIN_ITEMS'] },
      { label: 'Delete selected items', keys: ['DELETE_SELECTED', 'DELETE_SELECTED_ALT'] },
      { label: 'Ripple delete selected items', keys: ['RIPPLE_DELETE', 'RIPPLE_DELETE_ALT'] },
      { label: 'Insert freeze frame at playhead', keys: ['FREEZE_FRAME'] },
      { label: 'Link selected clips', keys: ['LINK_AUDIO_VIDEO'] },
      { label: 'Unlink selected clips', keys: ['UNLINK_AUDIO_VIDEO'] },
      { label: 'Toggle linked selection', keys: ['TOGGLE_LINKED_SELECTION'] },
      { label: 'Nudge (1px)', keys: ['NUDGE_LEFT', 'NUDGE_RIGHT', 'NUDGE_UP', 'NUDGE_DOWN'] },
      { label: 'Nudge (10px)', keys: ['NUDGE_LEFT_LARGE', 'NUDGE_RIGHT_LARGE', 'NUDGE_UP_LARGE', 'NUDGE_DOWN_LARGE'] },
    ],
  },
  {
    title: 'Tools',
    blurb: 'Tool switching for timeline editing modes.',
    items: [
      { label: 'Selection tool', keys: ['SELECTION_TOOL'] },
      { label: 'Trim edit tool', keys: ['TRIM_EDIT_TOOL'] },
      { label: 'Razor tool', keys: ['RAZOR_TOOL'] },
      { label: 'Split at cursor', keys: ['SPLIT_AT_CURSOR'] },
      { label: 'Rate stretch tool', keys: ['RATE_STRETCH_TOOL'] },
      { label: 'Slip tool', keys: ['SLIP_TOOL'] },
      { label: 'Slide tool', keys: ['SLIDE_TOOL'] },
    ],
  },
  {
    title: 'History and UI',
    blurb: 'Timeline history, zoom, and UI toggles.',
    items: [
      { label: 'Undo', keys: ['UNDO'] },
      { label: 'Redo', keys: ['REDO'] },
      { label: 'Zoom in timeline', keys: ['ZOOM_IN'] },
      { label: 'Zoom out timeline', keys: ['ZOOM_OUT'] },
      { label: 'Zoom to fit all content', keys: ['ZOOM_TO_FIT'] },
      { label: 'Zoom to 100%', keys: ['ZOOM_TO_100', 'ZOOM_TO_100_ALT'] },
      { label: 'Toggle snap', keys: ['TOGGLE_SNAP'] },
      { label: 'Toggle keyframe editor panel', keys: ['TOGGLE_KEYFRAME_EDITOR'] },
    ],
  },
  {
    title: 'Clipboard',
    blurb: 'Copy, cut, and paste commands shared across editor surfaces.',
    items: [
      { label: 'Copy selected items or keyframes', keys: ['COPY'] },
      { label: 'Cut selected items or keyframes', keys: ['CUT'] },
      { label: 'Paste items or keyframes', keys: ['PASTE'] },
    ],
  },
  {
    title: 'Markers',
    blurb: 'Marker creation, removal, and navigation.',
    items: [
      { label: 'Add marker at playhead', keys: ['ADD_MARKER'] },
      { label: 'Remove selected marker', keys: ['REMOVE_MARKER'] },
      { label: 'Jump to previous marker', keys: ['PREVIOUS_MARKER'] },
      { label: 'Jump to next marker', keys: ['NEXT_MARKER'] },
    ],
  },
  {
    title: 'Keyframes',
    blurb: 'Keyframe editor actions and view switching.',
    items: [
      { label: 'Clear all keyframes from selected items', keys: ['CLEAR_KEYFRAMES'] },
      { label: 'Switch keyframe editor to graph view', keys: ['KEYFRAME_EDITOR_GRAPH'] },
      { label: 'Switch keyframe editor to dopesheet view', keys: ['KEYFRAME_EDITOR_DOPESHEET'] },
    ],
  },
  {
    title: 'Source Monitor',
    blurb: 'In and out points plus insert and overwrite edits.',
    items: [
      { label: 'Mark In point', keys: ['MARK_IN'] },
      { label: 'Mark Out point', keys: ['MARK_OUT'] },
      { label: 'Clear In/Out points', keys: ['CLEAR_IN_OUT'] },
      { label: 'Insert edit', keys: ['INSERT_EDIT'] },
      { label: 'Overwrite edit', keys: ['OVERWRITE_EDIT'] },
    ],
  },
  {
    title: 'Project',
    blurb: 'Save and export flows.',
    items: [
      { label: 'Save project', keys: ['SAVE'] },
      { label: 'Export video', keys: ['EXPORT'] },
      { label: 'Open Scene Browser (search AI captions)', keys: ['OPEN_SCENE_BROWSER'] },
    ],
  },
] as const;
