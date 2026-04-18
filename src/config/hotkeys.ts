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
  SPLIT_AT_PLAYHEAD: 'mod+k',
  SPLIT_AT_PLAYHEAD_ALT: 'alt+c',
  JOIN_ITEMS: 'shift+j',
  DELETE_SELECTED: 'delete',
  DELETE_SELECTED_ALT: 'backspace',
  RIPPLE_DELETE: 'mod+delete',
  RIPPLE_DELETE_ALT: 'mod+backspace',
  FREEZE_FRAME: 'shift+f',
  LINK_AUDIO_VIDEO: 'mod+alt+l',
  UNLINK_AUDIO_VIDEO: 'alt+shift+l',
  TOGGLE_LINKED_SELECTION: 'shift+l',
  NUDGE_LEFT: 'shift+left',
  NUDGE_RIGHT: 'shift+right',
  NUDGE_UP: 'shift+up',
  NUDGE_DOWN: 'shift+down',
  NUDGE_LEFT_LARGE: 'mod+shift+left',
  NUDGE_RIGHT_LARGE: 'mod+shift+right',
  NUDGE_UP_LARGE: 'mod+shift+up',
  NUDGE_DOWN_LARGE: 'mod+shift+down',

  // History
  UNDO: 'mod+z',
  REDO: 'mod+shift+z',

  // Zoom
  ZOOM_IN: 'mod+equal',
  ZOOM_OUT: 'mod+minus',
  ZOOM_TO_FIT: 'backslash',
  ZOOM_TO_100: 'shift+backslash',
  ZOOM_TO_100_ALT: 'mod+0',

  // Clipboard
  COPY: 'mod+c',
  CUT: 'mod+x',
  PASTE: 'mod+v',

  // Tools
  SELECTION_TOOL: 'v',
  TRIM_EDIT_TOOL: 't',
  RAZOR_TOOL: 'c',
  SPLIT_AT_CURSOR: 'shift+c',
  RATE_STRETCH_TOOL: 'r',
  SLIP_TOOL: 'y',
  SLIDE_TOOL: 'u',

  // Project
  SAVE: 'mod+s',
  EXPORT: 'mod+shift+e',

  // UI
  TOGGLE_SNAP: 's',
  OPEN_SCENE_BROWSER: 'mod+shift+f',

  // Markers
  ADD_MARKER: 'm',
  REMOVE_MARKER: 'shift+m',
  PREVIOUS_MARKER: 'bracketleft',
  NEXT_MARKER: 'bracketright',

  // Keyframes
  CLEAR_KEYFRAMES: 'shift+a',
  TOGGLE_KEYFRAME_EDITOR: 'mod+shift+a',
  KEYFRAME_EDITOR_GRAPH: '1',
  KEYFRAME_EDITOR_DOPESHEET: '2',

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

export const HOTKEY_EXPORT_SCHEMA = 'freecut-hotkeys';
export const HOTKEY_EXPORT_VERSION = 1;

export interface HotkeyExportCommand {
  id: HotkeyKey;
  label: string;
  binding: string;
  defaultBinding: string;
  isCustom: boolean;
}

export interface HotkeyExportDocument {
  schema: typeof HOTKEY_EXPORT_SCHEMA;
  version: typeof HOTKEY_EXPORT_VERSION;
  exportedAt: string;
  commands: HotkeyExportCommand[];
  overrides: HotkeyOverrideMap;
}

export interface HotkeyImportCommand {
  id?: string;
  key?: string;
  label?: string;
  binding?: string;
  shortcut?: string;
  defaultBinding?: string;
}

export interface HotkeyImportResult {
  overrides: HotkeyOverrideMap;
  importedCommandCount: number;
  ignoredCommandCount: number;
  remappedCommandCount: number;
  sourceVersion: number | null;
}

export interface BrowserHostileHotkey {
  binding: string;
  browserAction: string;
}

interface HotkeyCommandLookup {
  byLabel: Map<string, HotkeyKey>;
  byDefaultBinding: Map<string, HotkeyKey>;
}

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
  '=': 'equal',
  equals: 'equal',
  '-': 'minus',
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
  equal: '=',
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
  Equal: 'equal',
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

const HOTKEY_COMMAND_ALIASES: Partial<Record<string, HotkeyKey>> = {};

const BROWSER_HOSTILE_HOTKEYS: readonly BrowserHostileHotkey[] = [
  { binding: 'alt+left', browserAction: 'Back navigation' },
  { binding: 'alt+right', browserAction: 'Forward navigation' },
  { binding: 'f5', browserAction: 'Reload page' },
  { binding: 'mod+r', browserAction: 'Reload page' },
  { binding: 'mod+shift+r', browserAction: 'Hard reload page' },
  { binding: 'mod+t', browserAction: 'New tab' },
  { binding: 'mod+shift+t', browserAction: 'Reopen closed tab' },
  { binding: 'mod+w', browserAction: 'Close tab' },
  { binding: 'mod+n', browserAction: 'New window' },
  { binding: 'mod+shift+n', browserAction: 'New private window' },
  { binding: 'mod+l', browserAction: 'Focus address bar' },
  { binding: 'mod+shift+l', browserAction: 'Focus address bar or search in some browsers' },
  { binding: 'mod+d', browserAction: 'Bookmark page or focus address bar' },
  { binding: 'mod+e', browserAction: 'Focus search or address bar in some browsers' },
  { binding: 'mod+p', browserAction: 'Print page' },
  { binding: 'mod+f', browserAction: 'Find in page' },
  { binding: 'mod+equal', browserAction: 'Browser zoom in' },
  { binding: 'mod+minus', browserAction: 'Browser zoom out' },
  { binding: 'mod+0', browserAction: 'Reset browser zoom' },
  { binding: 'mod+1', browserAction: 'Switch to tab 1' },
  { binding: 'mod+2', browserAction: 'Switch to tab 2' },
  { binding: 'mod+3', browserAction: 'Switch to tab 3' },
  { binding: 'mod+4', browserAction: 'Switch to tab 4' },
  { binding: 'mod+5', browserAction: 'Switch to tab 5' },
  { binding: 'mod+6', browserAction: 'Switch to tab 6' },
  { binding: 'mod+7', browserAction: 'Switch to tab 7' },
  { binding: 'mod+8', browserAction: 'Switch to tab 8' },
  { binding: 'mod+9', browserAction: 'Switch to last tab' },
] as const;

const BROWSER_HOSTILE_HOTKEY_MAP = new Map(
  BROWSER_HOSTILE_HOTKEYS.map((entry) => [entry.binding, entry])
);

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
  SPLIT_AT_PLAYHEAD_ALT: 'Split at playhead (alternative)',
  JOIN_ITEMS: 'Join selected clips',
  DELETE_SELECTED: 'Delete selected items',
  DELETE_SELECTED_ALT: 'Delete selected items (alternative)',
  RIPPLE_DELETE: 'Ripple delete selected items',
  RIPPLE_DELETE_ALT: 'Ripple delete selected items (alternative)',
  FREEZE_FRAME: 'Insert freeze frame at playhead',
  LINK_AUDIO_VIDEO: 'Link selected clips',
  UNLINK_AUDIO_VIDEO: 'Unlink selected clips',
  TOGGLE_LINKED_SELECTION: 'Toggle linked selection',
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
  ZOOM_IN: 'Zoom in timeline',
  ZOOM_OUT: 'Zoom out timeline',
  ZOOM_TO_FIT: 'Zoom to fit all content',
  ZOOM_TO_100: 'Zoom to 100% at cursor or playhead',
  ZOOM_TO_100_ALT: 'Zoom to 100% at cursor or playhead (alternative)',

  // Clipboard
  COPY: 'Copy selected items or keyframes',
  CUT: 'Cut selected items or keyframes',
  PASTE: 'Paste items or keyframes',

  // Tools
  SELECTION_TOOL: 'Selection tool',
  TRIM_EDIT_TOOL: 'Trim edit tool',
  RAZOR_TOOL: 'Razor tool',
  SPLIT_AT_CURSOR: 'Split at cursor',
  RATE_STRETCH_TOOL: 'Rate stretch tool',
  SLIP_TOOL: 'Slip tool',
  SLIDE_TOOL: 'Slide tool',

  // Project
  SAVE: 'Save project',
  EXPORT: 'Export video',

  // UI
  TOGGLE_SNAP: 'Toggle snap',
  OPEN_SCENE_BROWSER: 'Open Scene Browser (search AI captions)',

  // Markers
  ADD_MARKER: 'Add marker at playhead',
  REMOVE_MARKER: 'Remove selected marker',
  PREVIOUS_MARKER: 'Jump to previous marker',
  NEXT_MARKER: 'Jump to next marker',

  // Keyframes
  CLEAR_KEYFRAMES: 'Clear all keyframes from selected items',
  TOGGLE_KEYFRAME_EDITOR: 'Toggle keyframe editor panel',
  KEYFRAME_EDITOR_GRAPH: 'Switch keyframe editor to graph view',
  KEYFRAME_EDITOR_DOPESHEET: 'Switch keyframe editor to dopesheet view',

  // Source Monitor
  MARK_IN: 'Mark In point',
  MARK_OUT: 'Mark Out point',
  CLEAR_IN_OUT: 'Clear In/Out points',
  INSERT_EDIT: 'Insert edit',
  OVERWRITE_EDIT: 'Overwrite edit',
};

const HOTKEY_COMMAND_LOOKUP = createHotkeyCommandLookup();

function getNavigatorPlatform(): string {
  if (typeof navigator === 'undefined') return 'Windows';

  const userAgentData = (navigator as Navigator & {
    userAgentData?: { platform?: string };
  }).userAgentData;

  if (typeof userAgentData?.platform === 'string') {
    return userAgentData.platform;
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
    ...sanitizeHotkeyOverrides(overrides),
  };
}

export function isHotkeyKey(value: string): value is HotkeyKey {
  return value in HOTKEYS;
}

export function resolveHotkeyKey(value: string): HotkeyKey | null {
  if (isHotkeyKey(value)) {
    return value;
  }

  return HOTKEY_COMMAND_ALIASES[value] ?? null;
}

function normalizeHotkeyCommandLabel(label: string): string {
  return label.trim().toLowerCase();
}

function createHotkeyCommandLookup(): HotkeyCommandLookup {
  const byLabel = new Map<string, HotkeyKey>();
  const byDefaultBinding = new Map<string, HotkeyKey>();

  for (const key of Object.keys(HOTKEYS) as HotkeyKey[]) {
    byLabel.set(normalizeHotkeyCommandLabel(HOTKEY_DESCRIPTIONS[key]), key);
    byDefaultBinding.set(normalizeHotkeyBinding(HOTKEYS[key]), key);
  }

  return {
    byLabel,
    byDefaultBinding,
  };
}

function resolveHotkeyImportCommand(command: HotkeyImportCommand): {
  key: HotkeyKey | null;
  wasRemapped: boolean;
} {
  const rawKey = typeof command.id === 'string'
    ? command.id
    : typeof command.key === 'string'
      ? command.key
      : null;

  if (rawKey) {
    const directKey = resolveHotkeyKey(rawKey);
    if (directKey) {
      return {
        key: directKey,
        wasRemapped: directKey !== rawKey,
      };
    }
  }

  if (typeof command.label === 'string') {
    const labelMatch = HOTKEY_COMMAND_LOOKUP.byLabel.get(normalizeHotkeyCommandLabel(command.label));
    if (labelMatch) {
      return {
        key: labelMatch,
        wasRemapped: true,
      };
    }
  }

  if (typeof command.defaultBinding === 'string') {
    const normalizedDefaultBinding = normalizeHotkeyBinding(command.defaultBinding);
    const bindingMatch = HOTKEY_COMMAND_LOOKUP.byDefaultBinding.get(normalizedDefaultBinding);
    if (bindingMatch) {
      return {
        key: bindingMatch,
        wasRemapped: true,
      };
    }
  }

  return {
    key: null,
    wasRemapped: false,
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

export function sanitizeHotkeyOverrides(overrides: unknown): HotkeyOverrideMap {
  if (!overrides || typeof overrides !== 'object') {
    return {};
  }

  const normalizedOverrides: HotkeyOverrideMap = {};

  for (const [rawKey, rawBinding] of Object.entries(overrides)) {
    if (!isHotkeyKey(rawKey) || typeof rawBinding !== 'string') {
      continue;
    }

    const normalizedBinding = normalizeHotkeyBinding(rawBinding);
    if (!normalizedBinding || !hasHotkeyPrimaryToken(normalizedBinding)) {
      continue;
    }

    if (normalizedBinding === HOTKEYS[rawKey]) {
      continue;
    }

    normalizedOverrides[rawKey] = normalizedBinding;
  }

  return normalizedOverrides;
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

export function getBrowserHostileHotkey(binding: string): BrowserHostileHotkey | null {
  const normalizedBinding = normalizeHotkeyBinding(binding);
  if (!normalizedBinding) {
    return null;
  }

  return BROWSER_HOSTILE_HOTKEY_MAP.get(normalizedBinding) ?? null;
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

export function createHotkeyExportDocument(overrides: HotkeyOverrideMap = {}): HotkeyExportDocument {
  const normalizedOverrides = sanitizeHotkeyOverrides(overrides);
  const bindings = resolveHotkeys(normalizedOverrides);
  const commandKeys = Object.keys(HOTKEYS) as HotkeyKey[];

  return {
    schema: HOTKEY_EXPORT_SCHEMA,
    version: HOTKEY_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    commands: commandKeys.map((key) => ({
      id: key,
      label: HOTKEY_DESCRIPTIONS[key],
      binding: bindings[key],
      defaultBinding: HOTKEYS[key],
      isCustom: key in normalizedOverrides,
    })),
    overrides: normalizedOverrides,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

function getImportBinding(command: HotkeyImportCommand): string | null {
  if (typeof command.binding === 'string') {
    return command.binding;
  }

  if (typeof command.shortcut === 'string') {
    return command.shortcut;
  }

  return null;
}

function collectImportedOverrides(source: unknown): HotkeyImportResult {
  if (!isRecord(source)) {
    return {
      overrides: {},
      importedCommandCount: 0,
      ignoredCommandCount: 0,
      remappedCommandCount: 0,
      sourceVersion: null,
    };
  }

  const normalizedOverrides: HotkeyOverrideMap = {};
  let importedCommandCount = 0;
  let ignoredCommandCount = 0;
  let remappedCommandCount = 0;

  for (const [rawKey, rawBinding] of Object.entries(source)) {
    const resolvedKey = resolveHotkeyKey(rawKey);
    if (!resolvedKey || typeof rawBinding !== 'string') {
      ignoredCommandCount += 1;
      continue;
    }

    const normalizedBinding = normalizeHotkeyBinding(rawBinding);
    if (!normalizedBinding || !hasHotkeyPrimaryToken(normalizedBinding)) {
      ignoredCommandCount += 1;
      continue;
    }

    importedCommandCount += 1;
    if (resolvedKey !== rawKey) {
      remappedCommandCount += 1;
    }

    if (normalizedBinding !== HOTKEYS[resolvedKey]) {
      normalizedOverrides[resolvedKey] = normalizedBinding;
    }
  }

  return {
    overrides: normalizedOverrides,
    importedCommandCount,
    ignoredCommandCount,
    remappedCommandCount,
    sourceVersion: null,
  };
}

export function parseHotkeyImportDocument(source: unknown): HotkeyImportResult {
  if (!isRecord(source)) {
    throw new Error('Invalid hotkey preset format');
  }

  if (source.schema !== HOTKEY_EXPORT_SCHEMA) {
    return collectImportedOverrides(source);
  }

  const sourceVersion = typeof source.version === 'number' ? source.version : null;

  const overridesSource = isRecord(source.overrides) ? source.overrides : null;
  const commandsSource = Array.isArray(source.commands) ? source.commands : [];

  let importedCommandCount = 0;
  let ignoredCommandCount = 0;
  let remappedCommandCount = 0;
  const importedOverrides: HotkeyOverrideMap = {};

  if (overridesSource) {
    const overrideImport = collectImportedOverrides(overridesSource);
    importedCommandCount += overrideImport.importedCommandCount;
    ignoredCommandCount += overrideImport.ignoredCommandCount;
    remappedCommandCount += overrideImport.remappedCommandCount;
    Object.assign(importedOverrides, overrideImport.overrides);
  } else {
    for (const command of commandsSource) {
      if (!isRecord(command)) {
        ignoredCommandCount += 1;
        continue;
      }

      const importCommand = command as HotkeyImportCommand;
      const rawBinding = getImportBinding(importCommand);
      const resolvedCommand = resolveHotkeyImportCommand(importCommand);

      if (!resolvedCommand.key || !rawBinding) {
        ignoredCommandCount += 1;
        continue;
      }

      const normalizedBinding = normalizeHotkeyBinding(rawBinding);
      if (!normalizedBinding || !hasHotkeyPrimaryToken(normalizedBinding)) {
        ignoredCommandCount += 1;
        continue;
      }

      importedCommandCount += 1;
      if (resolvedCommand.wasRemapped) {
        remappedCommandCount += 1;
      }

      if (normalizedBinding !== HOTKEYS[resolvedCommand.key]) {
        importedOverrides[resolvedCommand.key] = normalizedBinding;
      }
    }
  }

  return {
    overrides: sanitizeHotkeyOverrides(importedOverrides),
    importedCommandCount,
    ignoredCommandCount,
    remappedCommandCount,
    sourceVersion,
  };
}

/**
 * Options for react-hotkeys-hook.
 * Prevents shortcuts from firing in input fields.
 */
export const HOTKEY_OPTIONS = {
  enableOnFormTags: false,
  preventDefault: true,
} as const;
