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
  space: '空格',
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
  left: '左',
  right: '右',
  up: '上',
  down: '下',
  home: 'Home',
  end: 'End',
  delete: 'Del',
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
  { binding: 'alt+left', browserAction: '后退导航' },
  { binding: 'alt+right', browserAction: '前进导航' },
  { binding: 'f5', browserAction: '刷新页面' },
  { binding: 'mod+r', browserAction: '刷新页面' },
  { binding: 'mod+shift+r', browserAction: '强制刷新页面' },
  { binding: 'mod+t', browserAction: '新建标签页' },
  { binding: 'mod+shift+t', browserAction: '重新打开已关闭标签页' },
  { binding: 'mod+w', browserAction: '关闭标签页' },
  { binding: 'mod+n', browserAction: '新建窗口' },
  { binding: 'mod+shift+n', browserAction: '新建隐私窗口' },
  { binding: 'mod+l', browserAction: '聚焦地址栏' },
  { binding: 'mod+shift+l', browserAction: '聚焦地址栏或搜索栏（部分浏览器）' },
  { binding: 'mod+d', browserAction: '收藏页面或聚焦地址栏' },
  { binding: 'mod+e', browserAction: '聚焦搜索栏或地址栏（部分浏览器）' },
  { binding: 'mod+p', browserAction: '打印页面' },
  { binding: 'mod+f', browserAction: '页内查找' },
  { binding: 'mod+equal', browserAction: '浏览器放大' },
  { binding: 'mod+minus', browserAction: '浏览器缩小' },
  { binding: 'mod+0', browserAction: '重置浏览器缩放' },
  { binding: 'mod+1', browserAction: '切换到标签页 1' },
  { binding: 'mod+2', browserAction: '切换到标签页 2' },
  { binding: 'mod+3', browserAction: '切换到标签页 3' },
  { binding: 'mod+4', browserAction: '切换到标签页 4' },
  { binding: 'mod+5', browserAction: '切换到标签页 5' },
  { binding: 'mod+6', browserAction: '切换到标签页 6' },
  { binding: 'mod+7', browserAction: '切换到标签页 7' },
  { binding: 'mod+8', browserAction: '切换到标签页 8' },
  { binding: 'mod+9', browserAction: '切换到最后一个标签页' },
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
  PLAY_PAUSE: '播放/暂停',
  PREVIOUS_FRAME: '上一帧',
  NEXT_FRAME: '下一帧',
  GO_TO_START: '跳到开头',
  GO_TO_END: '跳到末尾',
  NEXT_SNAP_POINT: '下一个吸附点',
  PREVIOUS_SNAP_POINT: '上一个吸附点',

  // Timeline editing
  SPLIT_AT_PLAYHEAD: '在播放头处分割',
  SPLIT_AT_PLAYHEAD_ALT: '在播放头处分割（备用）',
  JOIN_ITEMS: '合并所选片段',
  DELETE_SELECTED: '删除所选项目',
  DELETE_SELECTED_ALT: '删除所选项目（备用）',
  RIPPLE_DELETE: '波纹删除所选项目',
  RIPPLE_DELETE_ALT: '波纹删除所选项目（备用）',
  FREEZE_FRAME: '在播放头插入冻结帧',
  LINK_AUDIO_VIDEO: '链接所选片段',
  UNLINK_AUDIO_VIDEO: '取消链接所选片段',
  TOGGLE_LINKED_SELECTION: '切换联动选择',
  NUDGE_LEFT: '所选可视项目向左微移（1px）',
  NUDGE_RIGHT: '所选可视项目向右微移（1px）',
  NUDGE_UP: '所选可视项目向上微移（1px）',
  NUDGE_DOWN: '所选可视项目向下微移（1px）',
  NUDGE_LEFT_LARGE: '所选可视项目向左微移（10px）',
  NUDGE_RIGHT_LARGE: '所选可视项目向右微移（10px）',
  NUDGE_UP_LARGE: '所选可视项目向上微移（10px）',
  NUDGE_DOWN_LARGE: '所选可视项目向下微移（10px）',

  // History
  UNDO: '撤销',
  REDO: '重做',

  // Zoom
  ZOOM_IN: '时间线放大',
  ZOOM_OUT: '时间线缩小',
  ZOOM_TO_FIT: '缩放到适配全部内容',
  ZOOM_TO_100: '在光标或播放头处缩放到 100%',
  ZOOM_TO_100_ALT: '在光标或播放头处缩放到 100%（备用）',

  // Clipboard
  COPY: '复制所选项目或关键帧',
  CUT: '剪切所选项目或关键帧',
  PASTE: '粘贴项目或关键帧',

  // Tools
  SELECTION_TOOL: '选择工具',
  TRIM_EDIT_TOOL: '修剪编辑工具',
  RAZOR_TOOL: '剃刀工具',
  SPLIT_AT_CURSOR: '在光标处分割',
  RATE_STRETCH_TOOL: '速率拉伸工具',
  SLIP_TOOL: 'Slip 工具',
  SLIDE_TOOL: 'Slide 工具',

  // Project
  SAVE: '保存项目',
  EXPORT: '导出视频',

  // UI
  TOGGLE_SNAP: '切换吸附',

  // Markers
  ADD_MARKER: '在播放头添加标记',
  REMOVE_MARKER: '删除所选标记',
  PREVIOUS_MARKER: '跳到上一个标记',
  NEXT_MARKER: '跳到下一个标记',

  // Keyframes
  CLEAR_KEYFRAMES: '清除所选项目全部关键帧',
  TOGGLE_KEYFRAME_EDITOR: '切换关键帧编辑器面板',
  KEYFRAME_EDITOR_GRAPH: '切换关键帧编辑器到曲线视图',
  KEYFRAME_EDITOR_DOPESHEET: '切换关键帧编辑器到摄影表视图',

  // Source Monitor
  MARK_IN: '标记入点',
  MARK_OUT: '标记出点',
  CLEAR_IN_OUT: '清除入点/出点',
  INSERT_EDIT: '插入编辑',
  OVERWRITE_EDIT: '覆盖编辑',
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
