/**
 * Centralized keyboard shortcut configuration
 *
 * Uses `mod` for cross-platform Cmd (Mac) / Ctrl (Windows/Linux) handling.
 * react-hotkeys-hook automatically handles this translation.
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
  NUDGE_LEFT: 'alt+left',
  NUDGE_RIGHT: 'alt+right',
  NUDGE_UP: 'alt+up',
  NUDGE_DOWN: 'alt+down',
  NUDGE_LEFT_LARGE: 'alt+shift+left',
  NUDGE_RIGHT_LARGE: 'alt+shift+right',
  NUDGE_UP_LARGE: 'alt+shift+up',
  NUDGE_DOWN_LARGE: 'alt+shift+down',

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
export type HotkeyBindingMap = Record<HotkeyKey, string>;
export type HotkeyOverrideMap = Partial<Record<HotkeyKey, string>>;
export type HotkeyPlatform = 'mac' | 'windows';

const HOTKEY_MODIFIERS = ['mod', 'alt', 'shift'] as const;
const HOTKEY_MODIFIER_SET = new Set<string>(HOTKEY_MODIFIERS);
const HOTKEY_MODIFIER_ORDER = new Map<string, number>(HOTKEY_MODIFIERS.map((token, index) => [token, index]));

const HOTKEY_TOKEN_ALIASES: Record<string, string> = {
  cmd: 'mod',
  command: 'mod',
  ctrl: 'mod',
  control: 'mod',
  option: 'alt',
  return: 'enter',
  esc: 'escape',
  del: 'delete',
  arrowleft: 'left',
  arrowright: 'right',
  arrowup: 'up',
  arrowdown: 'down',
};

const HOTKEY_KEY_LABELS: Record<string, string> = {
  space: 'Space',
  comma: ',',
  period: '.',
  bracketleft: '[',
  bracketright: ']',
  minus: '-',
  equals: '=',
  slash: '/',
  backslash: '\\',
  semicolon: ';',
  quote: "'",
  backquote: '`',
  left: 'Left',
  right: 'Right',
  up: 'Up',
  down: 'Down',
  home: 'Home',
  end: 'End',
  delete: 'Delete',
  backspace: 'Backspace',
  escape: 'Esc',
  tab: 'Tab',
  enter: 'Enter',
};

const HOTKEY_CODE_TOKEN_MAP: Record<string, string> = {
  Space: 'space',
  Comma: 'comma',
  Period: 'period',
  BracketLeft: 'bracketleft',
  BracketRight: 'bracketright',
  Minus: 'minus',
  Equal: 'equals',
  Slash: 'slash',
  Backslash: 'backslash',
  Semicolon: 'semicolon',
  Quote: 'quote',
  Backquote: 'backquote',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
  Home: 'home',
  End: 'end',
  Delete: 'delete',
  Backspace: 'backspace',
  Escape: 'escape',
  Tab: 'tab',
  Enter: 'enter',
};

export interface HotkeyEventData {
  key?: string;
  code?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

/**
 * Human-readable descriptions for keyboard shortcuts.
 * Used for tooltips, help dialogs, and documentation.
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
  NUDGE_LEFT: 'Nudge selected visual items left (1px)',
  NUDGE_RIGHT: 'Nudge selected visual items right (1px)',
  NUDGE_UP: 'Nudge selected visual items up (1px)',
  NUDGE_DOWN: 'Nudge selected visual items down (1px)',
  NUDGE_LEFT_LARGE: 'Nudge selected visual items left (10px)',
  NUDGE_RIGHT_LARGE: 'Nudge selected visual items right (10px)',
  NUDGE_UP_LARGE: 'Nudge selected visual items up (10px)',
  NUDGE_DOWN_LARGE: 'Nudge selected visual items down (10px)',

  // History
  UNDO: 'Undo',
  REDO: 'Redo',

  // Zoom
  ZOOM_TO_FIT: 'Zoom to fit all content',
  ZOOM_TO_100: 'Zoom to 100% at cursor or playhead',

  // Clipboard
  COPY: 'Copy selected items or keyframes',
  CUT: 'Cut selected items or keyframes',
  PASTE: 'Paste items or keyframes',

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

function getNavigatorPlatform(): string {
  if (typeof navigator === 'undefined') return 'Windows';

  if ('userAgentData' in navigator && typeof navigator.userAgentData?.platform === 'string') {
    return navigator.userAgentData.platform;
  }

  return navigator.platform || navigator.userAgent || 'Windows';
}

export function getHotkeyPlatform(platformValue?: string): HotkeyPlatform {
  const platform = (platformValue ?? getNavigatorPlatform()).toLowerCase();
  return platform.includes('mac') || platform.includes('iphone') || platform.includes('ipad') ? 'mac' : 'windows';
}

export function resolveHotkeys(overrides: HotkeyOverrideMap = {}): HotkeyBindingMap {
  return {
    ...HOTKEYS,
    ...overrides,
  };
}

export function normalizeHotkeyToken(token: string): string {
  const normalized = token.trim().toLowerCase();
  if (!normalized) return '';
  return HOTKEY_TOKEN_ALIASES[normalized] ?? normalized;
}

export function splitHotkeyBinding(binding: string): string[] {
  return binding
    .split('+')
    .map((token) => normalizeHotkeyToken(token))
    .filter(Boolean);
}

export function normalizeHotkeyBinding(binding: string): string {
  const modifiers = new Set<string>();
  const keys: string[] = [];

  for (const token of splitHotkeyBinding(binding)) {
    if (HOTKEY_MODIFIER_SET.has(token)) {
      modifiers.add(token);
      continue;
    }

    if (!keys.includes(token)) {
      keys.push(token);
    }
  }

  const orderedModifiers = Array.from(modifiers).sort((left, right) => {
    return (HOTKEY_MODIFIER_ORDER.get(left) ?? 99) - (HOTKEY_MODIFIER_ORDER.get(right) ?? 99);
  });

  return [...orderedModifiers, ...keys].join('+');
}

export function hasHotkeyPrimaryToken(binding: string): boolean {
  return splitHotkeyBinding(binding).some((token) => !HOTKEY_MODIFIER_SET.has(token));
}

function formatHotkeyToken(token: string, platform: HotkeyPlatform): string {
  if (token === 'mod') {
    return platform === 'mac' ? 'Cmd' : 'Ctrl';
  }

  if (token === 'alt') {
    return platform === 'mac' ? 'Option' : 'Alt';
  }

  if (token === 'shift') {
    return 'Shift';
  }

  if (HOTKEY_KEY_LABELS[token]) {
    return HOTKEY_KEY_LABELS[token];
  }

  if (/^[a-z]$/.test(token)) {
    return token.toUpperCase();
  }

  return token;
}

export function formatHotkeyBinding(binding: string, platformValue?: string): string {
  const normalizedBinding = normalizeHotkeyBinding(binding);
  if (!normalizedBinding) return '';

  const platform = getHotkeyPlatform(platformValue);
  return normalizedBinding
    .split('+')
    .map((token) => formatHotkeyToken(token, platform))
    .join(' + ');
}

export function getHotkeyPrimaryTokenFromEventData(eventData: HotkeyEventData): string | null {
  const code = eventData.code ?? '';
  if (HOTKEY_CODE_TOKEN_MAP[code]) {
    return HOTKEY_CODE_TOKEN_MAP[code];
  }

  if (code.startsWith('Key') && code.length === 4) {
    return code.slice(3).toLowerCase();
  }

  if (code.startsWith('Digit') && code.length === 6) {
    return code.slice(5);
  }

  if (code.startsWith('Numpad') && code.length === 7) {
    return code.slice(6);
  }

  const key = normalizeHotkeyToken(eventData.key ?? '');
  if (!key || HOTKEY_MODIFIER_SET.has(key)) {
    return null;
  }

  if (key.length === 1 && /^[a-z0-9]$/.test(key)) {
    return key;
  }

  return HOTKEY_KEY_LABELS[key] ? key : null;
}

export function getHotkeyBindingFromEventData(eventData: HotkeyEventData): string | null {
  const tokens: string[] = [];

  if (eventData.ctrlKey || eventData.metaKey) {
    tokens.push('mod');
  }

  if (eventData.altKey) {
    tokens.push('alt');
  }

  if (eventData.shiftKey) {
    tokens.push('shift');
  }

  const primaryToken = getHotkeyPrimaryTokenFromEventData(eventData);
  if (primaryToken) {
    tokens.push(primaryToken);
  }

  if (tokens.length === 0) {
    return null;
  }

  return normalizeHotkeyBinding(tokens.join('+'));
}

export function getHotkeyConflictMap(bindings: HotkeyBindingMap): Record<string, HotkeyKey[]> {
  const conflicts: Record<string, HotkeyKey[]> = {};

  for (const [key, binding] of Object.entries(bindings) as [HotkeyKey, string][]) {
    const normalizedBinding = normalizeHotkeyBinding(binding);
    if (!normalizedBinding || !hasHotkeyPrimaryToken(normalizedBinding)) {
      continue;
    }

    conflicts[normalizedBinding] ??= [];
    conflicts[normalizedBinding].push(key);
  }

  return conflicts;
}

export function findHotkeyConflicts(
  bindings: HotkeyBindingMap,
  binding: string,
  currentKey?: HotkeyKey
): HotkeyKey[] {
  const normalizedBinding = normalizeHotkeyBinding(binding);
  if (!normalizedBinding || !hasHotkeyPrimaryToken(normalizedBinding)) {
    return [];
  }

  return (getHotkeyConflictMap(bindings)[normalizedBinding] ?? []).filter((key) => key !== currentKey);
}

/**
 * Options for react-hotkeys-hook.
 * Prevents shortcuts from firing in input fields.
 */
export const HOTKEY_OPTIONS = {
  enableOnFormTags: false,
  preventDefault: true,
} as const;
